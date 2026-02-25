const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
const GLib = imports.gi.GLib;

const _httpSession = new Soup.Session();

var GitHubHelper = class GitHubHelper {
  static gitHubTokenCreationURL = "https://github.com/settings/tokens/new?description=Cinnamon%20Desklet";

  static async getContributionData(username, token) {
    const query = `
      query {
        user(login: "${username}") {
          contributionsCollection {
            contributionCalendar {
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }
    `;

    const response = await GitHubHelper._makeGitHubGraphQLRequest(query, token);

    if (response && response.data && response.data.user && response.data.user.contributionsCollection) {
      return response.data.user.contributionsCollection.contributionCalendar.weeks;
    }
    throw new Error("Could not retrieve contribution data.");
  }

  static _makeGitHubGraphQLRequest(query, token) {
    return new Promise((resolve, reject) => {
      const url = "https://api.github.com/graphql";
      const body = JSON.stringify({ query });

      const message = Soup.Message.new("POST", url);
      if (!message) {
        return reject(new Error("Failed to create new Soup.Message"));
      }

      message.request_headers.append("Authorization", `bearer ${token}`);
      message.request_headers.append("User-Agent", "cinnamon-github-contribution-grid-desklet");
      message.request_headers.set_content_type("application/json", null);
      message.set_request_body_from_bytes("application/json", new GLib.Bytes(body));

      _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
        if (message.get_status() === 200) {
          const bytes = _httpSession.send_and_read_finish(result);
          const responseJson = JSON.parse(ByteArray.toString(bytes.get_data()));
          responseJson.errors ? reject(new Error(responseJson.errors.map(e => e.message).join(", "))) : resolve(responseJson);
        } else {
          reject(new Error(`Failed to fetch data: ${message.get_status()} ${message.get_reason_phrase()}`));
        }
      });
    });
  }

  static getContributionColor(count) {
    if (count >= 10) return "#56d364";
    if (count >= 9) return "#2ea043";
    if (count >= 6) return "#196c2e";
    if (count >= 4) return "#196c2e";
    if (count > 0) return "#033a16";
    if (count === 0) return "#151b23";
  }
};
