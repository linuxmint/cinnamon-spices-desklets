const Desklet = imports.ui.desklet;
const St = imports.gi.St;
function getRandomSentence() {
  var index = Math.floor(Math.random() * sentences.length);
  return sentences[index];
}

var sentences = [
  "Focus on the journey, not the destination.",
  "Comfort Zone ? Nah ! Lets take an extra step",
  "One day, all your hard work will pay off.",
  "It's worth the pain !",
  "Do what is right, not what is easy.",
  "We generate fears while we do nothing",
  "If we wait until we’re ready, we’ll be waiting for the rest of our lives.",
  "It’s never too late to be what you might have been.",
  "You don’t have to be great to start. But you have to start to be great.",
  "Work hard in silence. Let success make the noise",
  "Well begun is half done",
  "You will make everyone proud💫",
  "Don’t wish it were easier. Wish you were better.",
  "River cuts through rock not because of its power but because of its persistence.",
  "To change your life, you must first change your day",
  "Success is not final, failure is not fatal; it is the courage to continue that counts.",
  "There’s no traffic after the extra mile.",
  "Don’t stop until you’re proud.",
  "You can win if you want. . .",
  "Be the change you wish to see",
  "Your dreams are precious💎",
  "Dont let the temporary fun overtake your dreams",
];
function MyDesklet(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function (metadata, desklet_id) {
    Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
    this.setupUI();
  },

  setupUI() {
    // creates container for one child
    this.window = new St.Bin();
    // creates a label with test
    this.text = new St.Label({ text: getRandomSentence() });
    // adds label to container
    this.window.add_actor(this.text);
    // Sets the container as content actor of the desklet
    this.setContent(this.window);
  },
};

function main(metadata, desklet_id) {
  return new MyDesklet(metadata, desklet_id);
}
