// Minimal test runner, so the tests need nothing beyond gjs.
const System = imports.system;

let failureCount = 0;
let testCount = 0;

function test(name, body) {
    testCount++;
    try {
        body();
        print(`ok   - ${name}`);
    } catch (error) {
        failureCount++;
        print(`FAIL - ${name}\n       ${error.message}`);
    }
}

function assertEqual(actual, expected, label = "value") {
    const actualText = JSON.stringify(actual);
    const expectedText = JSON.stringify(expected);
    if (actualText !== expectedText) {
        throw new Error(`${label}: expected ${expectedText}, got ${actualText}`);
    }
}

function assertClose(actual, expected, tolerance, label = "value") {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${label}: expected ${expected} +/- ${tolerance}, got ${actual}`);
    }
}

function assertThrowsKind(body, expectedKind) {
    let thrown = null;
    try {
        body();
    } catch (error) {
        thrown = error;
    }
    if (!thrown) {
        throw new Error(`expected an error of kind ${expectedKind}, but nothing was thrown`);
    }
    if (thrown.kind !== expectedKind) {
        throw new Error(`expected error kind ${expectedKind}, got ${thrown.kind} (${thrown.message})`);
    }
}

function finish() {
    print(`${testCount - failureCount}/${testCount} passed`);
    if (failureCount > 0) {
        System.exit(1);
    }
}
