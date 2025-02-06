// "use strict";
const admin = require("firebase-admin");
const functions = require("firebase-functions");

const runTimeVars = functions.config().envvars;
const mySecretdsk = runTimeVars.mySecret.dsk;

const google = require('@googleapis/sheets')
const gauth = google.auth.fromJSON({
    "type": "service_account",
    "project_id": "mySecret-unified-library",
    "private_key_id": runTimeVars.google.drive.private_key_id,
    "private_key": runTimeVars.google.drive.private_key.replace(/\\\\n/g, "\n"),
    "client_email": runTimeVars.google.drive.client_email,
    "client_id": runTimeVars.google.drive.client_id,
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/google-drive%40mySecret-dealer-portal.iam.gserviceaccount.com",
})
gauth.scopes = ["https://www.googleapis.com/auth/spreadsheets"]
const sheets = google.sheets({
    version: 'v4',
    auth: gauth

})

//#region Cloud Functions Runtime Options
/**
 * Provides 8GB of memory with a 540 second timeout.
 * Should be reserved to those functions that take an extremely long time.
 */
const runtimeOpts540Sec8GB = {
    timeoutSeconds: 540,
    memory: "8GB",
};

/**
 * Provides 2GB of memory with a 30 second timeout.
 * Enough memory to not fail, but a short timeout life
 */
const runtimeOpts30Sec2GB = {
    timeoutSeconds: 30,
    memory: "2GB",
};

// If you need something inbetween these options
// Feel free to create a runtimeOption that suits your need

//#endregion

//#region Worker Functions

/** 
 * Workers are named tasks that can be invoked when calling the firebase function. 
 * The worker name determines what function(s) will execute on the provided arguments.
 */
let workers = {

    /**
     * Creates a new spreadsheet. 
     * 
     * @param {JSON} spreadsheet A JSON object that represents a spreadsheet. See [this schema](https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets#Spreadsheet).
     * @returns A promise.
     */
    createSpreadsheet: async ({ spreadsheet }) => {
        return await sheets.spreadsheets.create({ requestBody: spreadsheet })
    },


    /**
     * Clears values in the specified range from a specified sheet.
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} range The [A1 notation or R1C1 notation](https://developers.google.com/sheets/api/guides/concepts#cell) of the values to clear.
     * @param {string} spreadsheetId The ID of the spreadsheet to update.
     * @returns A promise
     */
    clearRange: async ({ range, spreadsheetId }) => {
        return await sheets.spreadsheets.values.clear({ range: range, spreadsheetId: spreadsheetId })
    },


    /**
     * Returns the spreadsheet of the given ID
     * 
     * @param {boolean} includeGridData True if grid data should be returned alongside the spreadsheet metadata
     * @param {Array<string>} ranges An array of [A1 or R1C1 notations](https://developers.google.com/sheets/api/guides/concepts#cell) for the ranges to retrieve from the spreadsheet.
     * @param {string} spreadsheetId The spreadsheet to request.
     * @returns A promise for the spreadsheet
     */
    getSpreadsheet: async ({ includeGridData, ranges, spreadsheetId }) => {
        return await sheets.spreadsheets.get({
            includeGridData: includeGridData,
            ranges: ranges,
            spreadsheetId: spreadsheetId
        })
    },


    /**
     * Updates a specified range with the specified data.
     * 
     * @param {boolean} includeValuesInResponse Determines if the update response should include the values of the cells that were updated. By default, responses do not include the updated values. 
     * If the range to write was larger than the range actually written, the response includes all values in the requested range (excluding trailing empty rows and columns).
     * @param {string} range The [A1 notation](https://developers.google.com/sheets/api/guides/concepts#cell) of the values to update.
     * @param {string} spreadsheetId The ID of the spreadsheet to update.
     * @param {string} valueInputOption How the input data should be interpreted. See [this schema](https://developers.google.com/sheets/api/reference/rest/v4/ValueInputOption).
     * @param {JSON} updateBody The range to update and the data to update it with. See [this schema](https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values#ValueRange).
     * @returns A promise
     */
    updateValues: async ({ includeValuesInResponse, range, spreadsheetId, valueInputOption, updateBody }) => {
        return await sheets.spreadsheets.values.update({
            includeValuesInResponse: includeValuesInResponse,
            range: range,
            spreadsheetId: spreadsheetId,
            valueInputOption: valueInputOption,
            requestBody: updateBody
        })
    }
};

//#endregion

//#region Callable Cloud Functions

/** 
 * SAMPLE POST REQUEST BODY
 * {
 *     "data": {
 *         "worker": "yourDesiredWorkerNameHere",
 *         "args":[`array`,`values of`,`any args you want to use`,`can be string, or number, or another array (aoa), or anything else you need to pass in`],
 *         "dsk": "Dealer Special Key Here"
 *     }
 * }
 */

/**
 * Runs the cloud function using the specified runtime options and the data provided via HTTP
 */
exports.googleSheetsLandingOnCall = functions.runWith(runtimeOpts30Sec2GB).https.onCall(async (data) => {
    if (!data || !data.dsk || data.dsk !== mySecretdsk) {
        return `Invalid Access Code. Access Denied`;
    }

    if (!data.worker || data.worker === ``) {
        return `No worker given. Aborting.`;
    }

    /** This check was originally in place to prevent no arguments, but some list endpoints do not require any arguments (i.e. they only have optional arguments) */
    // if (!data.args || data.args.length === 0) {
    //     return `Must specify at least one argument in array format`;
    // }

    try {
        return await workers[data.worker](data.args);
    }
    catch (err) {
        return err;
    }
});

//#endregion

//#region Supporting Functions

//Any supporting functions you may need should go here. Don't clutter the workers var with unneccessary functions.

//#endregion
