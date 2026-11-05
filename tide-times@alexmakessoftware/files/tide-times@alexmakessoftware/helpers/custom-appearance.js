// Matches the padding themes give a desklet with borders, so the text clears the rounded corners.
const PADDING_PX = 12;

const RGB_OR_RGBA = /^rgba?\((\d+),(\d+),(\d+)(,[\d.]+)?\)$/;

function containerStyle({ textColour, backgroundColour, backgroundOpacity, cornerRadius }) {
    const background = backgroundColour.replace(RGB_OR_RGBA, `rgba($1,$2,$3,${backgroundOpacity})`);
    return `color: ${textColour}; background-color: ${background}; border-radius: ${cornerRadius}px; padding: ${PADDING_PX}px;`;
}
