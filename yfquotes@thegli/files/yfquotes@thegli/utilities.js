/**
 * Yahoo Finance Quotes: Utilities
 */

const C = require('./constants');

function Utilities(logger) {
    this.init(logger);
}

Utilities.prototype = {
    init: function(logger) {
        this.logger = logger;
    },

    existsProperty: function(object, property) {
        return object.hasOwnProperty(property)
            && typeof object[property] !== "undefined"
            && object[property] !== null;
    },

    // convert the quotes list to a comma-separated one-liner, to be used as argument for the YFQ "symbols" parameter
    buildSymbolsArgument: function(quoteSymbolsText) {
        return quoteSymbolsText
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "")
            .map((line) => line.split(";")[0].toUpperCase())
            .join();
    },

    // extract any customization parameters from each entry in the quotes list, and return them in a map
    buildSymbolCustomizationMap: function(quoteSymbolsText) {
        const symbolCustomizations = new Map();
        for (const line of quoteSymbolsText.trim().split("\n")) {
            const customization = this.parseSymbolLine(line);
            symbolCustomizations.set(customization.symbol, customization);
        }
        this.logger.debug("symbol customization map size: " + symbolCustomizations.size);

        return symbolCustomizations;
    },

    parseSymbolLine: function(symbolLine) {
        const lineParts = symbolLine.trim().split(";");

        const customAttributes = new Map();
        for (const attr of lineParts.slice(1)) {
            const [key, value] = attr.split("=");
            if (key && value) {
                customAttributes.set(key, value);
            }
        }

        return this.buildSymbolCustomization(lineParts[0], customAttributes);
    },

    // data structure for quote customization parameters
    buildSymbolCustomization: function(symbol, customAttributes) {
        return {
            symbol: symbol.toUpperCase(),
            name: customAttributes.has("name") ? customAttributes.get("name") : null,
            style: customAttributes.has("style") ? customAttributes.get("style") : "normal",
            weight: customAttributes.has("weight") ? customAttributes.get("weight") : "normal",
            color: customAttributes.has("color") ? customAttributes.get("color") : null,
        }
    },

    compareSymbolsArgument: function(symbolsArgument, quoteSymbolsText) {
        const argumentFromText = this.buildSymbolsArgument(quoteSymbolsText);
        this.logger.debug("compare symbolsArgument(" + symbolsArgument + ") with argumentFromText(" + argumentFromText + ")");
        return symbolsArgument === argumentFromText;
    },

    // determine and store the quote name to display within the quote as new property "displayName"
    populateQuoteDisplayName: function(quote, symbolCustomization, useLongName) {
        let displayName = C.ABSENT;

        if (symbolCustomization.name !== null) {
            displayName = symbolCustomization.name;
        } else if (useLongName && this.existsProperty(quote, "longName")) {
            displayName = quote.longName;
        } else if (this.existsProperty(quote, "shortName")) {
            displayName = quote.shortName;
        }

        quote.displayName = displayName;
    },

    sortQuotesByProperty: function(quotes, prop, direction) {
        // don't sort if no criteria was given, or the criteria says "natural order", or there is only one quote
        if (prop === undefined || prop === "none" || quotes.length < 2) {
            return quotes;
        }

        // when sort-by-name is configured, then we want to sort by the determined display name
        if (prop === "shortName") {
            prop = "displayName";
        }

        const _that = this;
        const clone = quotes.slice(0);
        const numberPattern = /^-?\d+(\.\d+)?$/;
        clone.sort(function(q1, q2) {
            let p1 = "";
            if (_that.existsProperty(q1, prop)) {
                p1 = q1[prop].toString().match(numberPattern) ? + q1[prop] : q1[prop].toLowerCase();
            }
            let p2 = "";
            if (_that.existsProperty(q2, prop)) {
                p2 = q2[prop].toString().match(numberPattern) ? + q2[prop] : q2[prop].toLowerCase();
            }

            return ((p1 < p2) ? -1 : ((p1 > p2) ? 1 : 0)) * direction;
        });
        return clone;
    }
}

module.exports = Utilities;
