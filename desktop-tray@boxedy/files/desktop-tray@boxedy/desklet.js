//javascript ui imports
const AppletManager = imports.ui.appletManager;
const Desklet = imports.ui.desklet;
const DeskletManager = imports.ui.deskletManager;
const Extension = imports.ui.extension;
const Flashspot = imports.ui.flashspot;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;
//gobject introspection imports
const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
//other imports
const Util = imports.misc.util;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Tweener = imports.ui.tweener;
//------------------------------------------------------------------------------ PinHold -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ PinHold -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ PinHold -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ PinHold -------------------------------------------------------------------------//
let toPin = {x:0,y:0,pined:false};
function PinHold(){this._init();}
PinHold.prototype = {
	_init: function(){
		this.pinedHold = new St.Group({visible:false,x:toPin.x,y:toPin.y});
		Main.uiGroup.add_actor(this.pinedHold);
		this.boxBg = new St.Bin();
		this.pinedHold.add_actor(this.boxBg);
		let stack = new Cinnamon.Stack();
		this.boxBg.child = stack;
		this.boxContent = new St.Bin();
		stack.add_actor(this.boxContent);
	},
	addPin: function(desklet){
		this.desklet = desklet;
		this.boxContent.add_actor(this.desklet.actor);
		this.pinedHold.show();
		global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
		global.stage.set_key_focus(this.pinedHold);
		this.pinedHold.grab_key_focus();
	},
	removePin: function(){
		if(this.desklet){this.boxContent.remove_actor(this.desklet.actor);}
		this.pinedHold.destroy();
		global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
	}
}
//------------------------------------------------------------------------------ myDesklet -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ myDesklet -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ myDesklet -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ myDesklet -------------------------------------------------------------------------//
function myDesklet(metadata,desklet_id){this._init(metadata,desklet_id);}
myDesklet.prototype = {__proto__: Desklet.Desklet.prototype,
	_init: function(metadata, desklet_id){
		Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
		this.desklet_id = desklet_id;
		this.metadata = metadata;
		this.uuid = this.metadata["uuid"];

		this.bindSettings();
		this.bindKey();
		this.build();
	},
	//-------------------------------------------------------------------------- build
	//-------------------------------------------------------------------------- build
	//-------------------------------------------------------------------------- build
	//-------------------------------------------------------------------------- build
	build: function(){ 
		if(this.base){
			this.base.destroy();
		}
		//variables
		this.iAlpha = 0;
		this.sAlpha = 0;
		this.cAlpha = 0;
		this.btnSignalClick = 0;
		this.btnSignalHover = 0;
		//start build
		this.base = new St.Bin();
		this.setContent(this.base);
		//inf
		this.inf = new St.Bin();
		this.inf.y_align = St.Align.START;
		this.base.add_actor(this.inf);
		// button
		this.btn = new St.Button();
		this.inf.add_actor(this.btn);
		//table
		this.tableHolder = new St.BoxLayout();
		this.btn.add_actor(this.tableHolder);
		//build table
		this.tableHolder.add(this.buildTable());
		//
		this.buildText();
		this.setTextViews();
		this.setInfSize();
		this.setInfState();
		this.setFixPos();
		this.setColors();
		this.visSides();
		this.visCorners();
		this.setContextMenu();
	},
	//-------------------------------------------------------------------------- pin
    //-------------------------------------------------------------------------- pin
    //-------------------------------------------------------------------------- pin
    //-------------------------------------------------------------------------- pin
    togglePin: function(){
    	if(toPin.pined){
    		this.unpin();
    	}else{
    		this.pin();
    	}
    },
    pin: function(){
        if(toPin.pined||this.changingPinState){
        	return;
        } 
        let monitor = Main.layoutManager.focusMonitor;
        toPin.x = this.actor.x;
        toPin.y = this.actor.y;
        this.changingPinState = true;
        this.pinedHold = new PinHold();
        this.actor.get_parent().remove_actor(this.actor);
        this.pinedHold.addPin(this);
        toPin.pined = true;
        this.changingPinState = false;
    },
    unpin: function(){
        if(!toPin.pined||this.changingPinState){
        	return;
        }
        this.changingPinState = true;
        if(this.pinedHold){
        	this.pinedHold.removePin();
        } 
        Main.deskletContainer.addDesklet(this.actor);
        toPin.pined = false;
        this.changingPinState = false;
    },
	//-------------------------------------------------------------------------- rClickMenu - shortcutKey - settings
	//-------------------------------------------------------------------------- rClickMenu - shortcutKey - settings
	//-------------------------------------------------------------------------- rClickMenu - shortcutKey - settings
	//-------------------------------------------------------------------------- rClickMenu - shortcutKey - settings
	setContextMenu: function(){
		this._menu = new PopupMenu.PopupMenu(this.inf,0.0,St.Side.LEFT,0);
		this.mMan = new PopupMenu.PopupMenuManager(this);
		this.mMan.addMenu(this._menu);
		Main.uiGroup.add_actor(this._menu.actor);
		this._menu.actor.hide();
		this.fixPosMenuItem = new PopupMenu.PopupSwitchMenuItem("Fix Position",this.fixPos);
		this.fixPosMenuItem.connect('activate',Lang.bind(this,this.toggleFixPos));
		this._menu.addMenuItem(this.fixPosMenuItem);
		this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
	},
	bindKey: function(){
		if(this.keyId){
			Main.keybindingManager.removeHotKey(this.keyId);
		}
		this.keyId = "toggleCollapseShortcut"+this.uuid+this.desklet_id;
		Main.keybindingManager.addHotKey(this.keyId,this.toggleKey,Lang.bind(this,this.toggleCollapse));
	},
	bindSettings: function(){





		////////////////////////////////////////////////////////////////////////////// TODO
		/*"fixPos": {
	        "type": "button",
	        "description": "pin/unpin",
	        "callback": "togglePin"
	    },*/







		this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.desklet_id);
		//-------------------------------------------------------------------------------------------------------------------------------------------- settings START
		this.settings.bindProperty(Settings.BindingDirection.IN,"toggleKey","toggleKey",this.bindKey);
		this.settings.bindProperty(Settings.BindingDirection.IN,"changePointer","changePointer");
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,"fixPos","fixPos",this.setFixPos);
		//-------------------------------------------------------------------------------------------------------------------------------------------- Tray
		//---------------------------------------------------------------------- Size
		//---------------------------------------------------------------------- Size
		//this.settings.bindProperty(Settings.BindingDirection.IN,"widthRatio","widthRatio",this.setInfSize);//when scale slider fixed?
		//this.settings.bindProperty(Settings.BindingDirection.IN,"heightRatio","heightRatio",this.setInfSize);//when scale slider fixed?
		this.settings.bindProperty(Settings.BindingDirection.IN,"width","width",this.setInfSize);
		this.settings.bindProperty(Settings.BindingDirection.IN,"height","height",this.setInfSize);
		//---------------------------------------------------------------------- Collapsed
		//---------------------------------------------------------------------- Collapsed
		this.settings.bindProperty(Settings.BindingDirection.IN,"collapsedSize","collapsedSize",this.setInfSize);
		this.settings.bindProperty(Settings.BindingDirection.IN,"collapsedSpeed","collapsedSpeed");//animation time
		this.settings.bindProperty(Settings.BindingDirection.IN,"collapsedDir","collapsedDir",this.setInfState);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,"collapsed","collapsed",this.setInfState);
		//---------------------------------------------------------------------- Text
		//---------------------------------------------------------------------- Text
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,"txtVisible","txtVisible",this.setTextViews);

		this.settings.bindProperty(Settings.BindingDirection.IN,"txtColor","txtColor",this.setTextTypography);
		this.settings.bindProperty(Settings.BindingDirection.IN,"txtSize","txtSize",this.setTextTypography);
		this.settings.bindProperty(Settings.BindingDirection.IN,"txtFont","txtFont",this.setTextTypography);
		this.settings.bindProperty(Settings.BindingDirection.IN,"txtDisplay","txtDisplay",this.setText);	
		this.settings.bindProperty(Settings.BindingDirection.IN,"showScrollBar","showScrollBar",this.setTextTypography);

		this.settings.bindProperty(Settings.BindingDirection.IN,"bgImg","bgImg",this.setTextTypography);
		this.settings.bindProperty(Settings.BindingDirection.IN,"imgFile","imgFile",this.setTextTypography);
		//---------------------------------------------------------------------- Color & Opacity
		//---------------------------------------------------------------------- Color & Opacity
		this.settings.bindProperty(Settings.BindingDirection.IN,"bAlpha","bAlpha",this.setBtnAlpha);
		this.settings.bindProperty(Settings.BindingDirection.IN,"hlColor","hlColor",this.setColors);
		this.settings.bindProperty(Settings.BindingDirection.IN,"fg1Color","fg1Color",this.setColors);
		this.settings.bindProperty(Settings.BindingDirection.IN,"fg2Color","fg2Color",this.setColors);
		this.settings.bindProperty(Settings.BindingDirection.IN,"bgColor","bgColor",this.setColors);
		//-------------------------------------------------------------------------------------------------------------------------------------------- Sides
		//---------------------------------------------------------------------- Visibility
		//---------------------------------------------------------------------- Visibility
		this.settings.bindProperty(Settings.BindingDirection.IN,"topVis","topVis",this.visSides);
		this.settings.bindProperty(Settings.BindingDirection.IN,"leftVis","leftVis",this.visSides);
		this.settings.bindProperty(Settings.BindingDirection.IN,"rightVis","rightVis",this.visSides);
		this.settings.bindProperty(Settings.BindingDirection.IN,"bottomVis","bottomVis",this.visSides);
		//---------------------------------------------------------------------- Color
		//---------------------------------------------------------------------- Color
		this.settings.bindProperty(Settings.BindingDirection.IN,"sideColorTL","sideColorTL",this.setColors);
		this.settings.bindProperty(Settings.BindingDirection.IN,"sideColorBR","sideColorBR",this.setColors);
		this.settings.bindProperty(Settings.BindingDirection.IN,"sideColorFocused","sideColorFocused",this.setColors);
		//---------------------------------------------------------------------- Size
		//---------------------------------------------------------------------- Size
		this.settings.bindProperty(Settings.BindingDirection.IN,"sideLengthRatio","sideLengthRatio",this.setInfSize);
		this.settings.bindProperty(Settings.BindingDirection.IN,"sideBreadthRatio","sideBreadthRatio",this.setInfSize);
		this.settings.bindProperty(Settings.BindingDirection.IN,"sideBreadthRatioFocused","sideBreadthRatioFocused",this.focusInf);
		//-------------------------------------------------------------------------------------------------------------------------------------------- Corners
		//---------------------------------------------------------------------- Visibility
		//---------------------------------------------------------------------- Visibility
		this.settings.bindProperty(Settings.BindingDirection.IN,"tlVis","tlVis",this.visCorners);
		this.settings.bindProperty(Settings.BindingDirection.IN,"trVis","trVis",this.visCorners);
		this.settings.bindProperty(Settings.BindingDirection.IN,"blVis","blVis",this.visCorners);
		this.settings.bindProperty(Settings.BindingDirection.IN,"brVis","brVis",this.visCorners);
		//---------------------------------------------------------------------- Color
		//---------------------------------------------------------------------- Color
		this.settings.bindProperty(Settings.BindingDirection.IN,"cornerColorTL","cornerColorTL",this.setColors);
		this.settings.bindProperty(Settings.BindingDirection.IN,"cornerColorBR","cornerColorBR",this.setColors);
		this.settings.bindProperty(Settings.BindingDirection.IN,"cornerColorFocused","cornerColorFocused",this.setColors);
		//---------------------------------------------------------------------- Size
		//---------------------------------------------------------------------- Size
		this.settings.bindProperty(Settings.BindingDirection.IN,"cornerLengthRatio","cornerLengthRatio",this.setInfSize);
		this.settings.bindProperty(Settings.BindingDirection.IN,"cornerBreadthRatio","cornerBreadthRatio",this.setInfSize);
		this.settings.bindProperty(Settings.BindingDirection.IN,"cornerSize","cornerSize",this.setInfSize);
		//-------------------------------------------------------------------------------------------------------------------------------------------- settings END
	},
	//-------------------------------------------------------------------------- Typography - text
	//-------------------------------------------------------------------------- Typography - text
	//-------------------------------------------------------------------------- Typography - text
	//-------------------------------------------------------------------------- Typography - text
	setTextTypography: function(){
		let logStyle = "font-size: "+this.txtSize+"pt; font-family: "+this.txtFont+"; color: "+this.txtColor+";";
		if(this.bgImg&&this.imgFile!=""){
			logStyle += " background-image: url(\""+this.imgFile.substring(7)+"\"); background-position: 0px 0px;";
		}
		this.daTxt.set_style(logStyle);
		this.scrollBox.get_vscroll_bar().visible = this.showScrollBar;
	},
	setTextViews: function(){
		if(!this.txtVisible){
			this.showText(false);
			return;
		}else{
			this.showText(true);
		}
		this.setText();
		this.setTextTypography();
	},
	setText: function(){
		this.daTxt.text = this.txtDisplay;
	},
	showText: function(show){
		if(show&&this.txtVisible){
			this.scrollBox.show();
		}else{
			this.scrollBox.hide();
		}
	},
	buildText: function(){
		this.center.y_align = St.Align.START;
		this.center.x_align = St.Align.START;
		this.center.x_fill = true;
		this.center.y_fill = true;
		this.daTxt = new St.Label();
		this.daTxt.set_clip_to_allocation(false);
		this.daTxt.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
		this.daTxt.clutter_text.line_wrap = true;
		this.daTxt.clutter_text.set_selectable(true);
		let textBox = new St.BoxLayout();
		textBox.add_actor(this.daTxt);
		this.scrollBox = new St.ScrollView();
		this.scrollBox.add_actor(textBox);
		this.center.add_actor(this.scrollBox);
		this.center.add_actor(this.daTxt);
		this.setTextTypography();
	},
	//-------------------------------------------------------------------------- interface
	//-------------------------------------------------------------------------- interface
	//-------------------------------------------------------------------------- interface
	//-------------------------------------------------------------------------- interface
	setInfState: function(){
		let anaSize = 0;
		if(this.collapsed){this.showText(false);
		}else{
			if(this.collapsedDir=="top"){
				anaSize = this.height;
			}else if(this.collapsedDir=="left"){
				anaSize = this.width;
			}
			this.setBtnAlpha();
		}
		if(this.collapsedSpeed>0){
			this.setInfSize("onlyButtonPlease");
			this.anaInfState(anaSize);
		}else{
			this.finInfState(anaSize);
		}
		//this.bringToTop();
	},
	anaInfState: function(val){
		let anaObj = {onComplete:Lang.bind(this,function(){this.finInfState(val);})};
		anaObj.time = this.collapsedSpeed;
		anaObj.transition = 'easeInSine';//easeInSine'easeInQuad
		if(this.collapsedDir=="top"){
			anaObj.height = val;
		}else if(this.collapsedDir=="left"){
			anaObj.width = val;
		}                    
		Tweener.addTween(this.inf,anaObj);
	},
	finInfState: function(val){//this.log("--finInfState: "+val);
		if(this.collapsed){
			val = this.collapsedSize;this.setBtnAlpha(0);
		}else{
			this.showText(true);
		}
		if(this.collapsedDir=="top"){
			this.btn.height = val;
			this.inf.height = val;
		}else if(this.collapsedDir=="left"){
			this.btn.width = val;
			this.inf.width = val;
		}
	},
	toggleCollapse: function() {
		this.collapsed = !this.collapsed;this.setInfState();
	},
	toggleFixPos: function(){
		this.fixPos = !this.fixPos;this.setFixPos();
	},
	setFixPos: function(){
		if(this.fixPos){
			this.btn.show();
			this.setInfState();
			this.toggleBtnSignals(true);
			//this.setSideAlpha(0);
			this.setInfAlpha(0);
		}else{
			this.btn.hide();
			this.setInfSize();
			this.toggleBtnSignals(false);
			//this.setSideAlpha(0.2);
			this.setInfAlpha(0.2);
		}
	},
	setInfSize: function(buttonOnly){this.log("	setInfSize buttonOnly: "+buttonOnly);
		this.btn.width = this.width;
		this.btn.height = this.height;
		if(buttonOnly=="onlyButtonPlease"){
			return;
		}
		this.inf.width = this.width;
		this.inf.height = this.height;
		this.sizeTable(this.width,this.height,this.cornerSize);
	},
	//-------------------------------------------------------------------------- btn and side signals click and hover
	//-------------------------------------------------------------------------- btn and side signals click and hover
	//-------------------------------------------------------------------------- btn and side signals click and hover
	//-------------------------------------------------------------------------- btn and side signals click and hover
	toggleBtnSignals: function(on){
		if(on){//this.log("toggleBtnSignals: true");
			if(this.btnSignalClick==0){
				this.btnSignalClick = this.btn.connect("clicked", Lang.bind(this,this.toggleCollapse));
			}
			if(this.btnSignalHover==0){
				this.btnSignalHover = this.btn.connect("notify::hover",Lang.bind(this,function(actor){this.focusInf(actor.get_hover());}));
			}
		}else{//this.log("toggleBtnSignals: false");
			if(this.btnSignalClick>0){
				this.btn.disconnect(this.btnSignalClick);this.btnSignalClick = 0;
			}
			if(this.btnSignalHover>0){
				this.btn.disconnect(this.btnSignalHover);this.btnSignalHover = 0;
			}
		}
	},
	//-------------------------------------------------------------------------- alpha
	//-------------------------------------------------------------------------- alpha
	//-------------------------------------------------------------------------- alpha
	//-------------------------------------------------------------------------- alpha
	//not current being used
	setSideAlpha: function(alpha){
		if(alpha!=undefined){
			this.sAlpha = alpha;
		}
		let da = this.getBgColStr(this.hlColor,this.sAlpha);
		this.top.set_style(da);
		this.left.set_style(da);
		this.right.set_style(da);
		this.bottom.set_style(da);
	},
	setCornerAlpha: function(alpha){
		if(alpha!=undefined){
			this.cAlpha = alpha;
		}
		let da = this.getBgColStr(this.hlColor,this.cAlpha);
		this.tl.set_style(da);
		this.tr.set_style(da);
		this.bl.set_style(da);
		this.br.set_style(da);
	},
	//being used
	setInfAlpha: function(alpha){
		if(alpha!=undefined){
			this.iAlpha = alpha;
		}
		this.inf.set_style(this.getBgColStr(this.hlColor,this.iAlpha));
	},
	setBtnAlpha: function(alpha){
		if(alpha==undefined){
			alpha = this.bAlpha;
		}
		this.btn.set_style(this.getBgColStr(this.bgColor,alpha));
	},
	//-------------------------------------------------------------------------- color
	//-------------------------------------------------------------------------- color
	//-------------------------------------------------------------------------- color
	//-------------------------------------------------------------------------- color
	textRGB_RGBA: function(textRGB,alpha) {
		if(!alpha||alpha==0){
			alpha = "0.0";
		}
		return (textRGB.replace(")",","+alpha+")")).replace("rgb","rgba");
  	},
	getBgColStr: function(color,alpha){
		if(alpha==undefined){
			return "background-color: "+color+";";
		}else{
			return "background-color: "+this.textRGB_RGBA(color,alpha)+";"
		}
	},
	setColors: function(focus){//this.log("-----------------setColors focus: "+focus,"yellow");
		let cTL = "?";
		let cBR = "?";
		let sTL = "?";
		let sBR = "?";
		if(focus){
			cTL = cBR = this.getBgColStr(this[this.cornerColorFocused+"Color"]);
			sTL = sBR = this.getBgColStr(this[this.sideColorFocused+"Color"]);
		}else{//}else if(focus==undefined){
			cTL = this.getBgColStr(this[this.cornerColorTL+"Color"]);
			cBR = this.getBgColStr(this[this.cornerColorBR+"Color"]);
			sTL = this.getBgColStr(this[this.sideColorTL+"Color"]);
			sBR = this.getBgColStr(this[this.sideColorBR+"Color"]);
		}
		//this.setSideAlpha();
		this.tFill.set_style(sTL);
		this.lFill.set_style(sTL);
		this.rFill.set_style(sBR);
		this.bFill.set_style(sBR);
		//this.center.set_style('background-color: #000000;');
		this.tlFillA.set_style(cTL);
		this.tlFillB.set_style(cTL);
		this.trFillA.set_style(cTL);
		this.trFillB.set_style(cBR);
		this.blFillA.set_style(cTL);
		this.blFillB.set_style(cBR);
		this.brFillA.set_style(cBR);
		this.brFillB.set_style(cBR);
	},
	focusInf: function(focus){
		let sideSize = this.cornerSize*this.sideBreadthRatioFocused;
		if(focus==undefined){
			focus = true;
		}
		if(focus){
			if(this.changePointer){
				global.set_cursor(Cinnamon.Cursor.POINTING_HAND);
			}
		}else{
			if(this.changePointer){
				global.unset_cursor();
			}
			sideSize = this.cornerSize*this.sideBreadthRatio;
		}
		this.tFill.height = sideSize;
		this.lFill.width = sideSize;
		this.rFill.width = sideSize;
		this.bFill.height = sideSize;
		this.setColors(focus);
	},
	//-------------------------------------------------------------------------- visiblity
	//-------------------------------------------------------------------------- visiblity
	//-------------------------------------------------------------------------- visiblity
	//-------------------------------------------------------------------------- visiblity
	visSides: function(){
		if(this.topVis){
			this.tFill.show();
		}else{
			this.tFill.hide();
		}
		if(this.leftVis){
			this.lFill.show();
		}else{
			this.lFill.hide();
		}
		if(this.rightVis){
			this.rFill.show();
		}else{
			this.rFill.hide();
		}
		if(this.bottomVis){
			this.bFill.show();
		}else{t
			his.bFill.hide();
		}
	},
	visCorners: function(){
		if(this.tlVis){
			this.tl.show();
		}else{
			this.tl.hide();
		}
		if(this.trVis){
			this.tr.show();
		}else{
			this.tr.hide();
		}
		if(this.blVis){
			this.bl.show();
		}else{
			this.bl.hide();
		}
		if(this.brVis){
			this.br.show();
		}else{
			this.br.hide();
		}
	},
	//-------------------------------------------------------------------------- table creation and sizing
	//-------------------------------------------------------------------------- table creation and sizing
	//-------------------------------------------------------------------------- table creation and sizing
	//-------------------------------------------------------------------------- table creation and sizing
	sizeTable: function(w,h,m){this.log("sizeTable w: "+w+" h: "+h+" m: "+m);
		if(m==undefined){
			m = 10;
		}

		let sideW = w-(m*2);
		let sideH = h-(m*2);

		let sideWidth = sideW*this.sideLengthRatio;
		let sideHeight = sideH*this.sideLengthRatio;
		let sideBreadth = m*this.sideBreadthRatio;

		let cornerLength = m*this.cornerLengthRatio;
		let cornerBreadth = m*this.cornerBreadthRatio;

		this.log("cornerLength: "+cornerLength+" cornerBreadth: "+cornerBreadth,"yellow");

		//top left corner
		this.tl.width = m;
		this.tl.height = m;
		//top right corner
		//this.tr.width = m;
		//this.tr.height = m;
		//center
		this.center.width = sideW;
		this.center.height = sideH;
		//bottom left corner
		//this.bl.width = m;
		//this.bl.height = m;
		//bottom right corner
		this.br.width = m;
		this.br.height = m;
		
		//sides
		//top
		//this.top.width = sideW;
		//this.top.height = m;
		this.tFill.width = sideWidth;
		this.tFill.height = sideBreadth;
		//left
		//this.left.width = m;
		//this.left.height = sideH;
		this.lFill.width = sideBreadth;
		this.lFill.height = sideHeight;
		//right
		//this.right.width = m;
		//this.right.height = sideH;
		this.rFill.width = sideBreadth;
		this.rFill.height = sideHeight;
		//bottom
		//this.bottom.width = sideW;
		//this.bottom.height = m;
		this.bFill.width = sideWidth;
		this.bFill.height = sideBreadth;

		//corners -------------------------------------------------------------- A = hor | B = vert
		//top left corner
		//tlA
		//this.tlHoldA.width = cornerBreadth;
		//this.tlHoldA.height = m;
		this.tlFillA.width = cornerBreadth;
		this.tlFillA.height = cornerLength;
		//tlB
		this.tlFillB.width = cornerLength-cornerBreadth;
		this.tlFillB.height = cornerBreadth;
		//top right corner
		//trA
		this.trFillA.width = cornerLength-cornerBreadth;
		this.trFillA.height = cornerBreadth;
		//trB
		//this.trHoldB.width = cornerBreadth;
		//this.trHoldB.height = m;
		this.trFillB.width = cornerBreadth;
		this.trFillB.height = cornerLength;
		//bottom left corner
		//tlA
		//this.blHoldA.width = cornerBreadth;
		//this.blHoldA.height = m;
		this.blFillA.width = cornerBreadth;
		this.blFillA.height = cornerLength;
		//tlB
		//this.blHoldA.width = cornerSizeMinusBreadth;
		//this.blHoldA.height = m;
		this.blFillB.width = cornerLength-cornerBreadth;
		this.blFillB.height = cornerBreadth;
		//bottom right corner
		//trA
		//this.brHoldA.width = cornerSizeMinusBreadth;
		//this.brHoldA.height = cornerBreadth;
		this.brFillA.width = cornerLength-cornerBreadth;
		this.brFillA.height = cornerBreadth;
		//trB
		//this.brHoldB.width = cornerBreadth;
		//this.brHoldB.height = m;
		this.brFillB.width = cornerBreadth;
		this.brFillB.height = cornerLength;
	},
	buildTable: function(){
		//---------------------------------------------------------------------- buildTable START
		let table = new St.Table();
		//---------------------------------------------------------------------- top row
		this.tl = new St.BoxLayout();table.add(this.tl,{row:0,col:0});
		this.top = new St.Button();table.add(this.top,{row:0,col:1});
		this.tr = new St.BoxLayout();table.add(this.tr,{row:0,col:2});
		this.top.y_align = St.Align.START;
		this.tr.align_end = true;
		//---------------------------------------------------------------------- center row
		this.left = new St.Button();table.add(this.left,{row:1,col:0});
		this.center = new St.Bin();table.add(this.center,{row:1,col:1});
		this.right = new St.Button();table.add(this.right,{row:1,col:2});
		this.left.x_align = St.Align.START;
		this.right.x_align = St.Align.END;
		//---------------------------------------------------------------------- bottom row
		this.bl = new St.BoxLayout();table.add(this.bl,{row:2,col:0});
		this.bottom = new St.Button();table.add(this.bottom,{row:2,col:1});
		this.br = new St.BoxLayout();table.add(this.br,{row:2,col:2});
		this.bottom.y_align = St.Align.END;
		this.br.align_end = true;
		//---------------------------------------------------------------------- side fills
		this.tFill = new St.Bin();this.top.add_actor(this.tFill); 
		this.lFill = new St.Bin();this.left.add_actor(this.lFill);
		this.rFill = new St.Bin();this.right.add_actor(this.rFill);
		this.bFill = new St.Bin();this.bottom.add_actor(this.bFill);
		//---------------------------------------------------------------------- top left corner
		//this.tlHold = new St.BoxLayout();this.tl.add_actor(this.tlHold);
		//---------------------------------------------------------------------- A
		this.tlHoldA = new St.Bin();this.tl.add_actor(this.tlHoldA);
		this.tlFillA = new St.Bin();this.tlHoldA.add_actor(this.tlFillA);
		this.tlHoldA.x_align = St.Align.START;  
		this.tlHoldA.y_align = St.Align.START;
		//---------------------------------------------------------------------- B
		this.tlHoldB = new St.Bin();this.tl.add_actor(this.tlHoldB); 
		this.tlFillB = new St.Bin();this.tlHoldB.add_actor(this.tlFillB);
		this.tlHoldB.x_align = St.Align.START;
		this.tlHoldB.y_align = St.Align.START;
		//---------------------------------------------------------------------- top right corner
		//this.trHold = new St.BoxLayout();this.tr.add_actor(this.trHold);
		//---------------------------------------------------------------------- A
		this.trHoldA = new St.Bin();this.tr.add_actor(this.trHoldA); 
		this.trFillA = new St.Bin();this.trHoldA.add_actor(this.trFillA);
		this.trHoldA.x_align = St.Align.END; 
		this.trHoldA.y_align = St.Align.START;
		//---------------------------------------------------------------------- B
		this.trHoldB = new St.Bin();this.tr.add_actor(this.trHoldB);
		this.trFillB = new St.Bin();this.trHoldB.add_actor(this.trFillB);
		this.trHoldB.x_align = St.Align.END;
		this.trHoldB.y_align = St.Align.START;
		//----------------------------------------------------------------------- bottom left corner
		//this.blHold = new St.BoxLayout();this.bl.add_actor(this.blHold);
		//---------------------------------------------------------------------- A
		this.blHoldA = new St.Bin();this.bl.add_actor(this.blHoldA); 
		this.blFillA = new St.Bin();this.blHoldA.add_actor(this.blFillA);
		this.blHoldA.x_align = St.Align.START; 
		this.blHoldA.y_align = St.Align.END;
		//---------------------------------------------------------------------- B
		this.blHoldB = new St.Bin();this.bl.add_actor(this.blHoldB);
		this.blFillB = new St.Bin();this.blHoldB.add_actor(this.blFillB);
		this.blHoldB.x_align = St.Align.START;
		this.blHoldB.y_align = St.Align.END;
		//---------------------------------------------------------------------- bottom right corner
		//this.brHold = new St.BoxLayout();this.br.add_actor(this.brHold);
		//---------------------------------------------------------------------- A
		this.brHoldA = new St.Bin();this.br.add_actor(this.brHoldA);
		this.brFillA = new St.Bin();this.brHoldA.add_actor(this.brFillA);
		this.brHoldA.x_align = St.Align.END;
		this.brHoldA.y_align = St.Align.END;
		//---------------------------------------------------------------------- B
		this.brHoldB = new St.Bin();this.br.add_actor(this.brHoldB);
		this.brFillB = new St.Bin();this.brHoldB.add_actor(this.brFillB);
		this.brHoldB.x_align = St.Align.END;
		this.brHoldB.y_align = St.Align.END;
		//---------------------------------------------------------------------- buildTable END
		return table;
	},
	//-------------------------------------------------------------------------- round
	//-------------------------------------------------------------------------- round
	//-------------------------------------------------------------------------- round
	//-------------------------------------------------------------------------- round
	round: function(value,decimals){
		if(decimals!=undefined){
			return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
		}else{
			return Math.round(value);
		}
	},
	//-------------------------------------------------------------------------- log
	//-------------------------------------------------------------------------- log
	//-------------------------------------------------------------------------- log
	//-------------------------------------------------------------------------- log
	log: function(txt,type,breakLog){
		if(type==0||type=="log"||type=="green"){
			type = 0;
		}else if(type==1||type=="warning"||type=="yellow"){
			type = 1;
		}else if(type==2||type=="error"||type=="red"){
			type = 2;
		}else if(type==3||type=="trace"||type=="blue"){
			type = 3;
		}else if(type==undefined){
			type = this.logDefault;
		}

		if(type=="break"){
			type = this.logDefault;
			breakLog = true;
		}
		if(txt==undefined){
			this.logDefault = type;
			return;
		}
		if(breakLog!=undefined){
			txt = "BOXEDY-------------------------------------------------------------------------------------------------------------------------------- "+txt;
		}else{
			txt = "BOXEDY-------------------------------- "+txt;
		}

		if(type==0||type==undefined){
			global.log(txt);
		}else if(type==1){
			global.logWarning(txt);
		}else if(type==2){
			global.logError(txt);
		}else if(type==3){
			global.logTrace(txt);
		}
	}
}
//------------------------------------------------------------------------------ main -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ main -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ main -------------------------------------------------------------------------//
//------------------------------------------------------------------------------ main -------------------------------------------------------------------------//
function main(metadata,desklet_id){return new myDesklet(metadata, desklet_id);}