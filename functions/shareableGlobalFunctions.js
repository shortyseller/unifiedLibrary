/* eslint-disable no-await-in-loop */
// "use strict";
const { response } = require("express");
const admin = require("firebase-admin");
const functions = require("firebase-functions");

const runTimeVars = functions.config().envvars;
const mySecretdsk = runTimeVars.mySecret.dsk;
const fetch = require('fetch-retry')(require('node-fetch'));

// Imports the Google Cloud client library
const { Storage } = require('@google-cloud/storage');
// Creates a client from a Google service account key
const storage = new Storage({ keyFilename: `./unifieddatabaseserviceworker.json` });

//Imports the google cloud client library
const { DataTransferServiceClient } = require('@google-cloud/bigquery-data-transfer').v1
//Creates a client from a Google service account key
const dataTransferClient = new DataTransferServiceClient({ keyFile: `./unifieddatabaseserviceworker.json` });


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

//#region Global Shareable Server Functions

/**
 * Haults code execution for the specified time in milliseconds
 */
exports.sleep = function (time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

/**
 * Zoho auto pagination
 * 
 * @param {string} uri The endpoint for the first page
 * @param {Array<string>} uriOptions Options for the URI besides the page number
 * @param {JSON} options HTTP options for the fetch() function, including authorization and method headers
 * @param {string} dataKey The full key path to the data from the root of the response page.
 * @param {boolean} hasMorePage True/False for has_more_page
 * @param {number} rateLimit A number of milliseconds to delay between each page request. Required.
 * @param {number} startingPage The page to start from. 
 * @param {number} pageCount The total number of pages to fetch. Leave null value for default 1000 (all)
 *
 * @returns the accumulated result of all pages in the range [startingPage, startingPage+pageCount], flattened into one array
 */
exports.zohoOffsetPagination = async function (uri, uriOptions, options, dataKey, hasMorePage, rateLimit, startingPage, pageCount) {
    if (rateLimit === null || rateLimit === undefined) throw new Error("A rate_limit is required for automatic pagination.")
    let curPage = startingPage;
    if (uriOptions && uriOptions.length > 0) uriOptions = `&${uriOptions.join(`&`)}`;
    let theReturnerVals = [];
    if (!pageCount || pageCount <= 0) pageCount = 1000;
    while (hasMorePage === true && curPage <= pageCount) {
        let thisResult = await fetch(`${uri}?page=${curPage}${uriOptions}`, options)
            .then(response => response.json());
        if (thisResult && thisResult !== false && thisResult.code === 0 && thisResult.message === 'success') {
            let tmpThisBatch = thisResult[dataKey];
            let tmpArr = theReturnerVals.concat(tmpThisBatch);
            theReturnerVals = tmpArr;
            await exports.sleep(rateLimit);
            if (thisResult.page_context && thisResult.page_context.has_more_page) {
                hasMorePage = thisResult.page_context.has_more_page;
            } else {
                hasMorePage = false;
            }
        } else {
            hasMorePage = false;
        }
        curPage += 1;
    }
    console.log(theReturnerVals.length)
    return theReturnerVals;
}

/**
 * 
 * @param {string} bucketName The name of the cloud storage bucket to save to.
 * @param {string|Object} fileObject The contents of the file to save. Either a string or a [GCS File Object](https://googleapis.dev/nodejs/storage/latest/File.html).
 * @param {string} fileName The name of the file (including file extension).
 * @param {string} folderPath The complete folder path to store the file inside the GCS bucket.
 * @param {string} customTime (Optional) A user-specified timestamp for the object in RFC 3339 format. Does not overwrite "Last Created" or "Last Modified" but is instead a separate timestamp entry.
 * @returns A promise with no message - either rejected or resolved depending on if it succeeded or failed
 */
exports.createOrOverwriteFileAndTriggerBQImport = async function ({ transferConfigIDPath, bucketName, fileObject, fileName, folderPath, customTime }) {
    async function getTransferConfigId(transferPath) {
        const rdb = admin.database();
        let snapshot = await rdb.ref(`/dataTransferConfigIds/${transferPath}/`).once('value')
        let dbVal = snapshot.val();
        return dbVal;
    }
    if (!transferConfigIDPath) {
        console.error(`Error in createOrOverwriteFile: Missing transferConfigIDPath`);
        return Promise.resolve(`Error in createOrOverwriteFile: Missing transferConfigIDPath`);
    }
    const myBucket = storage.bucket(bucketName);

    if (!folderPath) {
        folderPath = "";
    }

    const file = myBucket.file(folderPath + fileName);
    const contents = fileObject;

    try {
        await file.save(contents, customTime ? { metadata: { customTime: customTime } } : undefined);
        console.log(`Waiting one minute for file to propagate to cloud visibility`)
        await exports.sleep(60000)
        console.log(`Done waiting one minute.`)
        await exports.triggerBQDataTransfer(await getTransferConfigId(transferConfigIDPath));
        return Promise.resolve("File saved successfully.");
    } catch (error) {
        console.error(`Error in createOrOverwriteFile: ${error.message}`);
        return Promise.resolve(`Error in createOrOverwriteFile: ${error.message}`);
    }
}

// /**
//  * 
//  * @param {string} bucketName The name of the cloud storage bucket to save to.
//  * @param {string|Object} fileObject The contents of the file to save. Either a string or a [GCS File Object](https://googleapis.dev/nodejs/storage/latest/File.html).
//  * @param {string} fileName The name of the file (including file extension).
//  * @param {string} folderPath The complete folder path to store the file inside the GCS bucket.
//  * @param {string} customTime (Optional) A user-specified timestamp for the object in RFC 3339 format. Does not overwrite "Last Created" or "Last Modified" but is instead a separate timestamp entry.
//  * @returns A promise with no message - either rejected or resolved depending on if it succeeded or failed
//  */
// exports.createOrOverwriteFile = async function ({ bucketName, fileObject, fileName, folderPath, customTime }) {
//     // The ID of your GCS bucket
//     const myBucket = storage.bucket(bucketName);

//     if (!folderPath) {
//         folderPath = "";
//     }

//     const file = myBucket.file(folderPath + fileName);
//     // const contents = JSON.stringify(fileObject, null, 2);
//     const contents = fileObject;

//     return await file.save(contents, customTime ? { metadata: { customTime: customTime } } : undefined);
// }

/**
 * Triggers a Google Cloud Big Query Data Transfer by its config Id and monitors its status.
 * 
 * @param {string} configId The config Id of the data transfer job to manually trigger.
 * @returns {Promise} Resolved if completed successfully, rejected if an error is thrown. 
 */
exports.triggerBQDataTransfer = async function triggerDataTransfer(configId) {
    const request = {
        parent: `PROJECTS LOCATION HERE/locations/us-central1/transferConfigs/${configId}`,
        requestedRunTime: { seconds: Math.floor(Date.now() / 1000) }
    };

    try {
        const [response] = await dataTransferClient.startManualTransferRuns(request);

        if (response && response.runs && response.runs.length > 0) {
            const run = response.runs[0];
            const runName = run.name;
            console.log(`Data transfer job ${runName} triggered, monitoring status...`);

            const result = await monitorTransferRun(runName);
            return Promise.resolve(result);
        } else {
            const errorMsg = `Failed to trigger data transfer job. Response: ${JSON.stringify(response)}`;
            console.error(errorMsg);
            return Promise.resolve(errorMsg);
        }
    } catch (error) {
        console.error(`Error triggering data transfer job: ${error.message}`);
        return Promise.resolve(`Error triggering data transfer job: ${error.message}`);
    }
};

/**
 * Monitors the status of a BigQuery Data Transfer run until it reaches a terminal state.
 * 
 * @param {string} runName The name of the data transfer run to monitor.
 * @returns {Promise} Resolved with the final state of the transfer run.
 */
async function monitorTransferRun(runName) {
    const pollInterval = 10000; // 10 seconds
    const maxPollAttempts = 30; // 5 minutes

    for (let i = 0; i < maxPollAttempts; i++) {
        try {
            const [run] = await dataTransferClient.getTransferRun({ name: runName });

            if (run.state === 'SUCCEEDED') {
                console.log(`Data transfer job ${runName} succeeded.`);
                return `Data transfer job ${runName} succeeded.`;
            } else if (run.state === 'FAILED') {
                console.error(`Data transfer job ${runName} failed.`);
                return `Data transfer job ${runName} failed.`;
            } else {
                console.log(`Data transfer job ${runName} state: ${run.state}`);
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        } catch (error) {
            console.error(`Error monitoring data transfer job ${runName}: ${error.message}`);
            return `Error monitoring data transfer job ${runName}: ${error.message}`;
        }
    }

    console.error(`Data transfer job ${runName} did not reach a terminal state within the time limit.`);
    return `Data transfer job ${runName} did not reach a terminal state within the time limit.`;
}


// /**
//  * Triggers a Google Cloud Big Query Data Transfer by its config Id.
//  * 
//  * @param {*} configId The config Id of the data transfer job to manually trigger
//  * @returns {Promise} Resolved if completed successfully, rejected if an error is thrown. 
//  */
// exports.triggerBQDataTransfer = async function triggerDataTransfer(configId) {
//     const request = {
//         parent: `PROJECTS LOCATION HERE/locations/us-central1/transferConfigs/${configId}`,
//         requestedRunTime: { seconds: Date.now() / 1000 }
//     }

//     try {
//         await dataTransferClient.startManualTransferRuns(request);
//         return Promise.resolve("Data transfer job triggered.")
//     } catch (error) {
//         console.error(error)
//         return Promise.reject(error)
//     }
// }

//#endregion

//#region Supporting Functions

//Any supporting functions you may need should go here. Don't clutter the workers var with unneccessary functions.

/**
 * Deletes all specified keys from the input (object or array of objects) and then returns the result.
 * 
 * @param {Array<JSON>} input The array to iterate.
 * @param {Array<string>} keysToDelete An array of key locations to delete. Accepts full paths to nested properties.
 * @returns {Array<JSON>} Returns with the results of delete iteration function.
 */
exports.deleteKeys = function (input, keysToDelete) {
    if (!Array.isArray(keysToDelete) || keysToDelete.length === 0)
        return input

    if (isObject(input)) {
        keysToDelete.forEach((key) => {
            if (key.includes("[") || key.includes("]") || key.includes("."))
                deletePath(input, key)
            else
                delete input[key]
        })
        return input
    }
    else if (Array.isArray(input) && input.every(e => isObject(e))) {
        return input.map((obj) => {
            keysToDelete.forEach((key) => {
                if (key.includes("[") || key.includes("]") || key.includes("."))
                    deletePath(obj, key)
                else
                    delete obj[key]
            })
            return obj
        })
    }

    return input
}


/**
 * formatDate() takes an incoming date object and formats it to string YYYY-MM-DD
 * @param {date} date the date to 
 * @returns {string} "YYYY-MM-DD"
 */
exports.formatDate = function (date) {
    var d = new Date(date),
        month = String(d.getMonth() + 1),
        day = String(d.getDate()),
        year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
}

/**
 * Checks if a variable is an object, is not an array, and is not null.
 * 
 * @param {*} o The variable to check 
 * @returns True if the variable is an object, not an array, and not null. False otherwise.
 */
exports.isObject = function (o) {
    return (typeof o === 'object' && !Array.isArray(o) && o !== null)
}

//#endregion

//#region local functions

/**
 * Checks if a variable is an object, is not an array, and is not null.
 * 
 * @param {*} o The variable to check 
 * @returns True if the variable is an object, not an array, and not null. False otherwise.
 */
function isObject(o) {
    return (typeof o === 'object' && !Array.isArray(o) && o !== null)
}


/**
 * Deletes a nested property on an object using a string of its full path
 * 
 * @param {Object} obj The object to delete the key from
 * @param {*} path The string for the full path of the property. Supports ['key'] or . to specify children
 */
function deletePath(obj, path) {
    //Clean up path string
    path.trim() //remove leading/trailing space
    path = path.replace(/\[('|")?(\w+)('|")?\]/g, '.$2');   // convert [] access to . access
    path = path.replace(/^\./, '');                         // remove leading dot

    //Iterate property tree
    const parts = path.split('.')
    const end = parts.pop()
    for (const part of parts) {
        obj = obj[part]
        if (!obj) break
    }

    //Delete
    delete obj[end]
}

//#endregion
