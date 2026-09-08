const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

const UUID = "minecraft-server-status@KopfdesDaemons";

var MinecraftServerStatusHelper = class {
  cacheDir;

  constructor(deskletId) {
    this.cacheDir = GLib.get_user_cache_dir() + "/" + UUID + "/" + deskletId;
  }

  /**
   * Main entry point to fetch the status of a Minecraft server.
   * Connects directly to the server and performs a Server List Ping (SLP).
   */
  async getServerStatus(address) {
    let host = address;
    let port = 25565; // Default Minecraft port

    // Use port from address if specified (e.g. "mc.example.com:25566")
    if (address.includes(":")) {
      const parts = address.split(":");
      host = parts[0];
      port = parseInt(parts[1], 10);
    }

    const result = await this._pingMinecraft(host, port);

    GLib.mkdir_with_parents(this.cacheDir, 0o755);

    if (result && result.favicon) {
      const b64Match = result.favicon.match(/^data:image\/png;base64,(.*)$/);
      if (b64Match) {
        try {
          const b64Data = b64Match[1];
          const decoded = GLib.base64_decode(b64Data);
          const safeHost = host.replace(/[^a-z0-9]/gi, "_");
          const filePath = this.cacheDir + "/favicon_" + safeHost + "_" + port + ".png";
          const file = Gio.File.new_for_path(filePath);
          const stream = await new Promise((resolve, reject) => {
            file.replace_async(null, false, Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null, (f, res) => {
              try {
                resolve(f.replace_finish(res));
              } catch (e) {
                reject(e);
              }
            });
          });
          await this._writeBytesAsync(stream, GLib.Bytes.new(decoded));
          await new Promise(resolve => stream.close_async(GLib.PRIORITY_DEFAULT, null, resolve));
          result.faviconPath = filePath;
        } catch (e) {
          global.logError(`[${UUID}] Error saving favicon: ${e}`);
        }
      }
    }

    return result;
  }

  // Helper to promisify the Gio socket connection
  _connectAsync(client, host, port) {
    return new Promise((resolve, reject) => {
      client.connect_to_host_async(host, port, null, (source, res) => {
        try {
          const connection = source.connect_to_host_finish(res);
          resolve(connection);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // Helper to promisify writing bytes to the stream
  _writeBytesAsync(outputStream, bytes) {
    return new Promise((resolve, reject) => {
      outputStream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (stream, res) => {
        try {
          stream.write_bytes_finish(res);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // Helper to promisify reading a specific number of bytes from the stream
  _readBytesAsync(input, count) {
    return new Promise((resolve, reject) => {
      input.read_bytes_async(count, GLib.PRIORITY_DEFAULT, null, (stream, res) => {
        try {
          const bytes = stream.read_bytes_finish(res);
          resolve(bytes.get_data());
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Handles the TCP connection and the Minecraft SLP packet exchange.
   */
  async _pingMinecraft(host, port) {
    const client = new Gio.SocketClient();
    // Set a 5-second timeout for the connection
    client.set_timeout(5);

    // Track the time to measure the actual server ping (latency)
    const startTime = Date.now();
    let connection = null;

    try {
      // 1. Establish the TCP connection
      connection = await this._connectAsync(client, host, port);

      const output = connection.get_output_stream();
      const input = connection.get_input_stream();

      // 2. Prepare the payload (Handshake Packet + Request Packet)
      const handshake = this._createHandshake(host, port);
      const request = new Uint8Array([0x01, 0x00]); // Length 1, Packet ID 0

      // Combine Handshake and Request into a single buffer to send at once
      const outBuf = new Uint8Array(handshake.length + request.length);
      outBuf.set(handshake, 0);
      outBuf.set(request, handshake.length);

      const bytesToSend = GLib.Bytes.new(outBuf);

      // 3. Send the payload to the server
      await this._writeBytesAsync(output, bytesToSend);

      // 4. Read the incoming response
      // The first part of the response is a VarInt indicating the total length of the packet
      const packetLength = await this._readVarIntAsync(input);
      if (packetLength <= 0) {
        throw new Error("Invalid packet length received");
      }

      // Read the exact amount of bytes specified by the packet length
      const data = await this._readExactBytesAsync(input, packetLength);

      // Calculate the ping based on the total time taken to receive the response
      const ping = Date.now() - startTime;

      // Close the connection gracefully
      try {
        connection.close(null);
      } catch (e) {}

      // 5. Parse the JSON response
      const result = this._parseResponse(data);
      result.ping = ping;

      return result;
    } catch (e) {
      // Make sure the connection is closed in case of an error
      if (connection) {
        try {
          connection.close(null);
        } catch (err) {}
      }
      throw e;
    }
  }

  /**
   * Reads exactly 'count' bytes from the stream.
   * It continues to read until the buffer is fully populated.
   */
  async _readExactBytesAsync(input, count) {
    const buffer = new Uint8Array(count);
    let offset = 0;

    while (offset < count) {
      const data = await this._readBytesAsync(input, count - offset);
      if (data.length === 0) {
        throw new Error("EOF before full packet read");
      }

      buffer.set(data, offset);
      offset += data.length;
    }

    return buffer;
  }

  /**
   * Creates a Minecraft Server List Ping handshake packet.
   */
  _createHandshake(host, port) {
    const hostBytes = ByteArray.fromString(host);
    const hostLen = this._varInt(hostBytes.length);

    // Convert the port number into a 2-byte array (unsigned short)
    const portBuffer = new Uint8Array(2);
    portBuffer[0] = (port >> 8) & 0xff;
    portBuffer[1] = port & 0xff;

    const packetId = this._varInt(0x00); // Handshake Packet ID is 0x00
    const protocol = this._varInt(47); // Protocol Version (47 = Minecraft 1.8, safe for pings)
    const nextState = this._varInt(1); // Next State (1 = Status)

    // Calculate total data length and allocate buffer
    const dataLength = packetId.length + protocol.length + hostLen.length + hostBytes.length + portBuffer.length + nextState.length;
    const data = new Uint8Array(dataLength);

    // Build the packet payload
    let offset = 0;
    data.set(packetId, offset);
    offset += packetId.length;
    data.set(protocol, offset);
    offset += protocol.length;
    data.set(hostLen, offset);
    offset += hostLen.length;
    data.set(hostBytes, offset);
    offset += hostBytes.length;
    data.set(portBuffer, offset);
    offset += portBuffer.length;
    data.set(nextState, offset);

    // Prepend the length of the data as a VarInt
    const lengthBytes = this._varInt(data.length);
    const packet = new Uint8Array(lengthBytes.length + data.length);
    packet.set(lengthBytes, 0);
    packet.set(data, lengthBytes.length);

    return packet;
  }

  /**
   * Encodes an integer into a Minecraft VarInt (Variable-length integer).
   */
  _varInt(val) {
    const bytes = [];
    while (true) {
      if ((val & 0xffffff80) === 0) {
        bytes.push(val);
        return new Uint8Array(bytes);
      }
      // Set the MSB to 1 to indicate more bytes are coming
      bytes.push((val & 0x7f) | 0x80);
      val >>>= 7;
    }
  }

  /**
   * Reads a VarInt from the stream byte-by-byte.
   * VarInts use 7 bits for data and the 8th bit to indicate if more bytes follow.
   */
  async _readVarIntAsync(input) {
    let numRead = 0;
    let result = 0;

    while (true) {
      // Read exactly 1 byte
      const data = await this._readBytesAsync(input, 1);
      if (data.length === 0) {
        throw new Error("EOF reached while reading VarInt");
      }

      const b = data[0];
      const value = b & 0x7f; // Extract the 7 lower bits
      result |= value << (7 * numRead); // Shift into position
      numRead++;

      if (numRead > 5) {
        throw new Error("VarInt is too big");
      }

      // If the Most Significant Bit (MSB) is 0, this is the last byte
      if ((b & 0x80) === 0) {
        return result;
      }
    }
  }

  /**
   * Parses the response buffer to extract the JSON status payload.
   */
  _parseResponse(array) {
    let offset = 0;

    // Helper to read a VarInt synchronously from the received memory buffer
    const readLocalVarInt = () => {
      let numRead = 0;
      let result = 0;
      let b;
      do {
        if (offset >= array.length) throw new Error("Index out of bounds reading VarInt");
        b = array[offset++];
        let value = b & 0x7f;
        result |= value << (7 * numRead);
        numRead++;
        if (numRead > 5) throw new Error("VarInt too big");
      } while ((b & 0x80) !== 0);
      return result;
    };

    // The first field is the Packet ID. It should be 0x00 for a Status Response.
    const packetId = readLocalVarInt();
    if (packetId !== 0x00) {
      throw new Error("Invalid packet ID in response");
    }

    // The next field is the length of the JSON string
    const jsonLength = readLocalVarInt();
    if (offset + jsonLength > array.length) {
      throw new Error("JSON length exceeds remaining data");
    }

    // Extract the JSON bytes and convert them to a string
    const jsonBytes = array.subarray(offset, offset + jsonLength);
    const jsonString = ByteArray.toString(jsonBytes);

    // Parse the JSON string
    const data = JSON.parse(jsonString);

    let players = 0;
    let maxPlayers = 0;

    // Safely extract the player counts
    if (data && data.players) {
      players = data.players.online || 0;
      maxPlayers = data.players.max || 0;
    }

    let favicon = "";
    if (data && data.favicon) {
      favicon = data.favicon;
    }

    return {
      online: true,
      players: players,
      maxPlayers: maxPlayers,
      favicon: favicon,
    };
  }

  _deleteAsync(file) {
    return new Promise(resolve => {
      file.delete_async(GLib.PRIORITY_DEFAULT, null, (f, res) => {
        try {
          f.delete_finish(res);
        } catch (e) {}
        resolve();
      });
    });
  }

  async _removeCache() {
    try {
      const cacheDirFile = Gio.File.new_for_path(this.cacheDir);

      const enumerator = await new Promise((resolve, reject) => {
        cacheDirFile.enumerate_children_async("standard::name", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (file, res) => {
          try {
            resolve(file.enumerate_children_finish(res));
          } catch (e) {
            reject(e);
          }
        });
      });

      const getNextFiles = () =>
        new Promise((resolve, reject) => {
          enumerator.next_files_async(50, GLib.PRIORITY_DEFAULT, null, (enumObj, res) => {
            try {
              resolve(enumObj.next_files_finish(res));
            } catch (e) {
              reject(e);
            }
          });
        });

      let infos;
      while ((infos = await getNextFiles()) && infos.length > 0) {
        const deletePromises = infos.map(info => this._deleteAsync(cacheDirFile.get_child(info.get_name())));
        await Promise.all(deletePromises);
      }

      enumerator.close(null);
      await this._deleteAsync(cacheDirFile);
    } catch (e) {
      if (e.code !== Gio.IOErrorEnum.NOT_FOUND) {
        global.logError(`[${UUID}] Error removing cache: ${e}`);
      }
    }
  }
};
