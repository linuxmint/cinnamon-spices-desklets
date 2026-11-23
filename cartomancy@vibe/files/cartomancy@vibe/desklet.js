const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

function MyDesklet(metadata, instance_id) {
    this._init(metadata, instance_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, instance_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, instance_id);
        // This line saves the folder path so the desklet can find its images
        this.metadata = metadata; 
        this.setupUI();
    },

    setupUI: function () {
        this.container = new St.BoxLayout({ 
            vertical: true, 
            style: "width: 260px; background-color: rgba(0,0,0,0.6); border-radius: 15px; padding: 10px;" 
        });
        
        this.image = new St.Icon({ icon_size: 240, style: "margin-bottom: 5px;" });
        
        this.label = new St.Label({ 
            text: "Click to Shuffle", 
            style: "text-align: center; font-size: 10pt; color: #f0f0f0;" 
        });
        
        this.label.clutter_text.line_wrap = true;
        this.label.clutter_text.line_wrap_mode = 2; 
        this.label.set_width(240);

        this.container.add_child(this.image);
        this.container.add_child(this.label);
        this.setContent(this.container);

        // Path to the default back of the card
        let backPath = this.metadata.path + "/images/black_joker.png";
        this.image.set_gicon(new Gio.FileIcon({ file: Gio.File.new_for_path(backPath) }));

        this.container.set_reactive(true);
        this.container.connect('button-press-event', () => {
            this.drawCard();
        });
    },

    drawCard: function() {
        const names = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'];
        const suits = ['heart', 'spade', 'diamond', 'club'];

        let n = names[Math.floor(Math.random() * names.length)];
        let s = suits[Math.floor(Math.random() * suits.length)];
        let cardKey = n + "_" + s;

        let path = this.metadata.path + "/images/" + cardKey + ".png";
        this.image.set_gicon(new Gio.FileIcon({ file: Gio.File.new_for_path(path) }));

        const poems = {
            "ace_heart": "A house of warmth, a cup filled high,\nNew love beneath a summer sky.\nThe hearth is lit, the door is wide,\nWith peace and joy to dwell inside.",
            "2_heart": "Two paths converge, two hearts align,\nA promise made by ancient design.\nIn quiet trust and shared delight,\nYour burdens now are feeling light.",
            "3_heart": "Raise up the glass, the news is sweet,\nA circle of friends is now complete.\nA celebration, a happy song,\nTo the place where you belong.",
            "4_heart": "Roots grow deep in fertile ground,\nWhere quiet, steady love is found.\nA solid base, a home so dear,\nNo storms of doubt shall venture near.",
            "5_heart": "The scenery shifts, the road is new,\nA different world comes into view.\nLeave the familiar far behind,\nFor treasures that you’ve yet to find.",
            "6_heart": "A ghost of kindness from the past,\nA childhood shadow, long and cast.\nA hand reached out from yesterday,\nTo guide you on your current way.",
            "7_heart": "A thousand dreams within your reach,\nMore than any book can teach.\nBut pick with care the path you tread,\nLest you follow whims instead.",
            "8_heart": "The party fades, the candles die,\nYou walk away without a sigh.\nFor though the room was filled with grace,\nYou seek a more profound place.",
            "9_heart": "The Star of Wishes, bright and clear,\nBrings the thing you hold most dear.\nA victory won, a dream made real,\nThe turning of the fortune wheel.",
            "10_heart": "The family gathered 'round the flame,\nNo more to worry, no more to blame.\nA legacy of love so deep,\nA promise that the heavens keep.",
            "Jack_heart": "A youth with eyes of summer blue,\nWho brings a message, bright and true.\nA romantic spirit, kind and bold,\nWhose loyalty is pure as gold.",
            "Queen_heart": "The Mother-Spirit, soft and mild,\nWho treats the stranger as her child.\nWith intuition as her guide,\nShe keeps the flame of love inside.",
            "King_heart": "The gentle ruler, wise and fair,\nWith silver in his noble hair.\nHe offers counsel, strength, and rest,\nA shelter for the weary guest.",
            "ace_diamond": "A spark of light, a letter sent,\nTo tell you where the fire went.\nNew ventures bloom like desert flowers,\nIn these, your most productive hours.",
            "2_diamond": "A coin for you, a coin for me,\nIn balanced, fair prosperity.\nA business deal, a debt repaid,\nThe foundations of your wealth are laid.",
            "3_diamond": "The work begins to show its worth,\nA small sprout breaks the frozen earth.\nThough full success is yet to come,\nYou hear the beat of Fortune’s drum.",
            "4_diamond": "The vault is locked, the plan is set,\nYou have no reason for regret.\nWith discipline and careful hand,\nYou rule the riches of your land.",
            "5_diamond": "A magnetism, sharp and bright,\nThat draws the people to your light.\nBut watch your words and keep your head,\nLest reckless things are done and said.",
            "6_diamond": "The green-eyed ghost begins to peer,\nAt what you hold and keep so dear.\nLet go of spite and jealous thought,\nOr lose the peace that you have bought.",
            "7_diamond": "The harvest moon is rising high,\nAcross the quiet autumn sky.\nFor every seed you dared to sow,\nA golden reward begins to show.",
            "8_diamond": "Lay by a stone for rainy days,\nIn quiet, thrifty, humble ways.\nFor though the sun is shining now,\nThe winter waits behind the plow.",
            "9_diamond": "A windfall comes from hands unknown,\nA seed of wealth you haven’t sown.\nAn open door, a sudden gain,\nTo wash away the financial strain.",
            "10_diamond": "The treasury is overflowing,\nWith every sign of success showing.\nSecurity for all your years,\nAnd end to all your earthly fears.",
            "Jack_diamond": "A messenger of spirit's light,\nWho walks the halls of deep insight.\nA student of the hidden way,\nWho brings the news of a better day.",
            "Queen_diamond": "With razor wit and steady gaze,\nShe navigates the worldly maze.\nAn independent, brilliant mind,\nThe smartest soul that you will find.",
            "King_diamond": "The master of the golden trade,\nBy whom the great fortunes are made.\nRenown and honor, power and skill,\nA man of iron, glass, and will.",
            "ace_club": "The ink is dry, the contract signed,\nA masterwork of human mind.\nA business starts, a seed is cast,\nA legacy that's built to last.",
            "2_club": "Two hands that pull the heavy oar,\nTo reach a distant, golden shore.\nIn cooperation, work is light,\nAnd every future goal is bright.",
            "3_club": "Look out across the wine-dark sea,\nTo see what your results shall be.\nThe ships are coming, sails are full,\nAgainst the tides of life they pull.",
            "4_club": "A resting place, a stable wall,\nA structure that will never fall.\nThe community is gathered near,\nWith nothing left to doubt or fear.",
            "5_club": "New faces join the table-round,\nNew alliances are quickly found.\nIn social circles, wide and vast,\nYou find a friend to hold at last.",
            "6_club": "The banners wave, the trumpets sound,\nYour victory is now renowned.\nRecognition for the work you've done,\nBeneath the bright and midday sun.",
            "7_club": "Against the world you take your stand,\nWith steady heart and steady hand.\nThough many challenge, you are right,\nA pillar in the darkest night.",
            "8_club": "The arrow flies, the message speeds,\nTo satisfy your greatest needs.\nFast progress comes, a journey starts,\nTo gladden all our weary hearts.",
            "9_club": "The barns are full of ripened grain,\nA shield against the wind and rain.\nMaterial gain and comfort deep,\nA promise that the earth will keep.",
            "10_club": "A milestone reached, a journey's end,\nWith many miles around the bend.\nSuccess in travel, trade, and toil,\nUpon this rich and ancient soil.",
            "Jack_club": "A youth of dark and steady eye,\nOn whom your trust can well rely.\nThrough thick and thin, through storm and gale,\nHis loyalty will never fail.",
            "Queen_club": "A helpful hand, a dark-haired grace,\nWith kindness written on her face.\nShe manages the world with ease,\nAnd brings the spirit to its knees.",
            "King_club": "A man of shadow, deep and strong,\nWho knows where every part belongs.\nA stable force, a quiet power,\nA refuge in a troubled hour.",
            "ace_spade": "The winter's breath, a sharp decree,\nA sudden change sets spirit free.\nThe old must fall, the new must rise,\nWith honest sight and open eyes.",
            "2_spade": "Two blades are crossed in silent truce,\nA temporary, fragile noose.\nSeek the peace while time allows,\nBefore the breaking of the vows.",
            "3_spade": "Sharp words are spoken, hearts are torn,\nLike roses hidden by the thorn.\nA mental stress, a clouded mind,\nWith jagged edges left behind.",
            "4_spade": "Lay down the sword, the fight is done,\nBeneath the cold and setting sun.\nA time for rest, a time to heal,\nUntil the turning of the wheel.",
            "5_spade": "Accept the loss and walk away,\nTo fight upon another day.\nThere is no shame in leaving fast,\nWhen shadows of the past are cast.",
            "6_spade": "The boat moves through the quiet mist,\nAway from all that does persist.\nTo calmer waters, shores of peace,\nWhere all the heavy tempests cease.",
            "7_spade": "A secret plan, a hidden scheme,\nA shadow in a waking dream.\nUse caution now, and watch your back,\nAlong the lonely, winding track.",
            "8_spade": "The iron bars are in your mind,\nNo other shackles do you find.\nStep forward through the open door,\nAnd be a prisoner no more.",
            "9_spade": "A midnight fear, a sleepless eye,\nBeneath a dark and heavy sky.\nThe anxiety that haunts the soul,\nMust yield to spirit’s self-control.",
            "10_spade": "The lowest point, the end of pain,\nThere is no further loss to gain.\nFrom here the only way is up,\nTo drink from a different, brighter cup.",
            "Jack_spade": "A clever youth with shifty glance,\nWho takes a wild and dangerous chance.\nA mind of mercury and steel,\nWho turns the secret, hidden wheel.",
            "Queen_spade": "A lonely queen on marble throne,\nWho rules her kingdom all alone.\nAmbitious, sharp, and cold as ice,\nShe's paid a heavy, bitter price.",
            "King_spade": "A powerful man with stern command,\nWho rules with law across the land.\nHe judges all with iron truth,\nFrom aged man to reckless youth."
        };

        let cardTitle = n + " of " + s + "s";
        let poemBody = poems[cardKey] || "A card of mystery.";

        this.label.set_text(cardTitle + "\n\n" + poemBody);
        
        let soundPath = this.metadata.path + '/sounds/';
        try {
            GLib.spawn_command_line_async('paplay ' + soundPath + 'shuffle.wav');
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                GLib.spawn_command_line_async('paplay ' + soundPath + 'flip.wav');
                return false;
            });
        } catch(e) {}
    }
};

function main(metadata, instance_id) {
    return new MyDesklet(metadata, instance_id);
}
