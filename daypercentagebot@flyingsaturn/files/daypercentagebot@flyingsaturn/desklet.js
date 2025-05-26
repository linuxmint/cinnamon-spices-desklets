const Desklet = imports.ui.desklet;
const St = imports.gi.St;

function MyDesklet(metadata, instance_id) {
    this._init(metadata, instance_id);
}

function main(metadata, instance_id) {
    return new MyDesklet(metadata, instance_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, instance_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);
    
        this.setupUI();
    },
    
    setupUI: function() {
    // main container for the desklet
    this.window = new St.Bin();
    this.text = new St.Label();
    this.text.set_text("Hello, world!");
    
    this.window.add_actor(this.text);
    this.setContent(this.window);
    }

    startControl: function(hourStart, minuteStart, hourEnd, minuteEnd) {
    // 12-hour can be handled by some other function
    startItBrother(hourStart, minuteStart, hourEnd, minuteEnd);
    controlHelper();
    setInterval(controlHelper, 5000);
    }

    startItBrother: function(hoursInit, minutesInit, hoursEnd, minutesEnd) {
    const now = new Date();
    initDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hoursInit, minutesInit);
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hoursEnd, minutesEnd); 
    if (endDate - initDate <= 0)
        endDate.setDate(endDate.getDate() + 1);
    }

    controlHelper: function() {
        let p = calcPercent(Date.now(), initDate, endDate);
        // Wrapping with a slight fall-through
        if (p > 100)
            p = updateItBrother();
        if (p < 0)
        {
            console.log("Time to sleep.");
            return;
        }
        console.log(`Progress: ${Math.floor(p)}%`);
    }

    updateItBrother: function() {
        initDate.setDate(initDate.getDate() + 1);
        endDate.setDate(endDate.getDate() + 1);
        return calcPercent(Date.now(), initDate, endDate);
    }

    calcPercent: function(currentTime, initTime, endTime) {
        const elapsedTime = Date.now() - initTime.getTime()
        const totalTime = endTime.getTime() - initTime.getTime()
        const percentTime = elapsedTime * 100.0 / totalTime
        return percentTime
    }    
};


