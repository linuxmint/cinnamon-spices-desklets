
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Sound = imports.ui.soundManager;



function Animation(fps)
{
	this._init(fps);
}
Animation.prototype = {
	_init: function(fps)
	{
		this.images = [];
		this.fps = fps;
	},
	
	addImage: function(image)
	{
		this.images.push(image);
	},
}



function AnimationPlayer()
{
	this._init();
}
AnimationPlayer.prototype = {
	_init: function(){
		this.loop_id = 0;
		this.animation = null;
		this.frame = 0;
		this.onUpdate = null;
		this.onFinish = null;
	},
	
	setAnimation: function(animation)
	{
		if(this.animation!=null)
		{
			Mainloop.source_remove(this.loop_id);
			this.loop_id = 0;
		}
		this.frame = 0;
		this.animation = animation;
		if(this.animation!=null)
		{
			this.loop_id = Mainloop.timeout_add(1000.0/this.animation.fps, Lang.bind(this, this._update_loop));
		}
		if(this.onUpdate!=null)
		{
			this.onUpdate();
		}
	},
	
	getCurrentImage: function()
	{
		if(this.animation==null)
		{
			return null;
		}
		else if(this.animation.images.length > 0)
		{
			return this.animation.images[this.frame];
		}
		return null;
	},
	
	_update_loop: function()
	{
		var finished = false;
		this.frame++;
		if(this.frame >= this.animation.images.length)
		{
			this.frame = 0;
		}
		this.loop_id = Mainloop.timeout_add(1000.0/this.animation.fps, Lang.bind(this, this._update_loop));
		if(finished && this.onFinish!=null)
		{
			this.onFinish();
		}
		if(this.onUpdate!=null)
		{
			this.onUpdate();
		}
	},
}



function createSprite()
{
	var sprite = new St.Bin();
	
	var lastImage = null;
	var animationPlayer = new AnimationPlayer();
	animationPlayer.onUpdate = function(){
		if(lastImage!=null)
		{
			sprite.remove_actor(lastImage);
		}
		lastImage = animationPlayer.getCurrentImage();
		if(lastImage!=null)
		{
			sprite.add_actor(lastImage);
		}
	};
	
	sprite.setAnimation = function(animation){
		animationPlayer.setAnimation(animation);
	};
	sprite.animationPlayer = animationPlayer;
	
	return sprite;
}



function Sharkle(metadata, desklet_id)
{
	this._init(metadata, desklet_id);
}
Sharkle.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id)
	{
		Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
		this.metadata = metadata;
		
		this.width = 200;
		this.height = 200;
		this.wavingHello = false;
		this.soundManager = new Sound.SoundManager();
		this.lastGreetingNum = -1;
		
		// Setup settings
		try
		{
			this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);
			this.settings.bind("color", "color", this.on_setting_changed);
		}
		catch(e)
		{
			global.logError(e);
		}
		
		
		// Setup main content
		this.mainContent = new Clutter.Group();
		this.mainContent.set_size(this.width, this.height);
		this.setContent(this.mainContent);
		
		//load animations
		this.animStash = {
			"white":{
				idle:null,
				hello:null,
				bubble:null,
			},
			"black":{
				idle:null,
				hello:null,
				bubble:null,
			},
		};
		this.animStash.white.idle = new Animation(10);
		this.animStash.black.idle = new Animation(10);
		for(var i=0; i<=7; i++)
		{
			this.animStash.white.idle.addImage(this.loadImage("images/white/idle_"+i+".png"));
			this.animStash.black.idle.addImage(this.loadImage("images/black/idle_"+i+".png"));
		}
		this.animStash.white.hello = new Animation(10);
		this.animStash.black.hello = new Animation(10);
		for(var i=0; i<=3; i++)
		{
			this.animStash.white.hello.addImage(this.loadImage("images/white/hello_"+i+".png"));
			this.animStash.black.hello.addImage(this.loadImage("images/black/hello_"+i+".png"));
		}
		this.animStash.white.bubble = new Animation(2);
		this.animStash.black.bubble = new Animation(2);
		for(var i=0; i<=1; i++)
		{
			this.animStash.white.bubble.addImage(this.loadImage("images/white/bubble_"+i+".png"));
			this.animStash.black.bubble.addImage(this.loadImage("images/black/bubble_"+i+".png"));
		}
		
		// Setup the shark
		this.shark = createSprite();
		this.shark.set_size(this.width, this.height);
		this.shark.setAnimation(this.animStash[this.color].idle);
		
		this.mainContent.add_actor(this.shark);
		
		//Setup the word bubble
		this.wordBubble = createSprite();
		this.wordBubble.set_size(this.width, this.height);
		this.wordBubble.anchor_x = (this.width*0.63);
		this.wordBubble.anchor_y = (this.height*0.63);
		
		this.mainContent.add_actor(this.wordBubble);
	},
	
	randomHex: function(length) {
		var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
		var text = "";
		for(var i=0; i<length; i++)
		{
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	},

	loadImage: function(filePath) {
		let path = "file://"+this.metadata.path+"/"+filePath;
		let image = St.TextureCache.get_default().load_uri_async(path, -1, -1);
		image.path = path;
		return image;
	},
	
	playSound: function(filePath) {
		global.log("playing sharkle sound");
		let path = this.metadata.path+"/"+filePath;
		var soundID = this.randomHex(12);
		this.soundManager.playSoundFile(soundID, path);
		global.log("played sharkle sound");
		return soundID;
	},
	
	playRandomGreeting: function() {
		var greetingNum = -1;
		do
		{
			greetingNum = Math.floor(Math.random()*8);
		}
		while(greetingNum == this.lastGreetingNum);
		this.lastGreetingNum = greetingNum;
		return this.playSound("audio/greeting_"+greetingNum+".wav");
	},
	
	on_desklet_clicked: function(event){
		if(!this.wavingHello)
		{
			this.wavingHello = true;
			this.shark.setAnimation(this.animStash[this.color].hello);
			this.wordBubble.setAnimation(this.animStash[this.color].bubble);
			this.playRandomGreeting();
			var _this = this;
			Mainloop.timeout_add(1600, function(){
				_this.shark.setAnimation(_this.animStash[_this.color].idle);
				_this.wordBubble.setAnimation(null);
				_this.wavingHello = false;
			});
		}
	},
	
	on_setting_changed: function(){
		if(this.wavingHello)
		{
			this.shark.setAnimation(this.animStash[this.color].hello);
			this.wordBubble.setAnimation(this.animStash[this.color].bubble);
		}
		else
		{
			this.shark.setAnimation(this.animStash[this.color].idle);
			this.wordBubble.setAnimation(null);
		}
	},
}



function main(metadata, desklet_id)
{
	return new Sharkle(metadata, desklet_id);
}

