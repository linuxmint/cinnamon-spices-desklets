// Global variables
let initDate;
let endDate;

// Function call
startControl(17, 00, 18, 00);

function startControl(hourStart, minuteStart, hourEnd, minuteEnd)
{
	// 12-hour can be handled by some other function
	startItBrother(hourStart, minuteStart, hourEnd, minuteEnd);
	controlHelper();
	setInterval(controlHelper, 5000);
}

function startItBrother(hoursInit, minutesInit, hoursEnd, minutesEnd)
{
	const now = new Date();
	initDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hoursInit, minutesInit);
	endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hoursEnd, minutesEnd); 
	if (endDate - initDate <= 0)
		endDate.setDate(endDate.getDate() + 1);
}

function controlHelper()
{
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

function updateItBrother()
{
	initDate.setDate(initDate.getDate() + 1);
	endDate.setDate(endDate.getDate() + 1);
	return calcPercent(Date.now(), initDate, endDate);
}

function calcPercent(currentTime, initTime, endTime)
{
	const elapsedTime = Date.now() - initTime.getTime()
	const totalTime = endTime.getTime() - initTime.getTime()
	const percentTime = elapsedTime * 100.0 / totalTime
	return percentTime
}










// day - midnight to 23:59 (here, 24:00 or 00:00)
