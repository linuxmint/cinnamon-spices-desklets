imports.searchPath.unshift("./files/tide-times@alexmakessoftware/helpers");
imports.searchPath.unshift("./tests");
const { test, assertEqual, finish } = imports.testing;
const CustomAppearance = imports["custom-appearance"];

function styleFor(backgroundColour, backgroundOpacity = 0.5) {
    return CustomAppearance.containerStyle({
        textColour: "rgb(1,2,3)",
        backgroundColour,
        backgroundOpacity,
        cornerRadius: 12,
    });
}

test("the style sets the text colour, corner radius and background with the chosen opacity", () => {
    assertEqual(
        styleFor("rgb(10,20,30)", 0.25),
        "color: rgb(1,2,3); background-color: rgba(10,20,30,0.25); border-radius: 12px; padding: 12px;"
    );
});

test("the opacity setting replaces any opacity already in the chosen colour", () => {
    assertEqual(
        styleFor("rgba(10,20,30,0.8)", 0.25),
        "color: rgb(1,2,3); background-color: rgba(10,20,30,0.25); border-radius: 12px; padding: 12px;"
    );
});

test("a fully transparent background is still valid", () => {
    assertEqual(
        styleFor("rgb(0,0,0)", 0),
        "color: rgb(1,2,3); background-color: rgba(0,0,0,0); border-radius: 12px; padding: 12px;"
    );
});

finish();
