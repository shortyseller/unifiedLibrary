/* use strict*/
/* eslint-disable no-await-in-loop*/
/* eslint-disable promise/no-nesting*/
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const { URLSearchParams } = require('url'); //Necessary to encode certain calls as urlencoded json
const fetch = require('fetch-retry')(require('node-fetch'));
const shareable = require(`./shareableGlobalFunctions`);
const runTimeVars = functions.config().envvars;

const mySecretdsk = runTimeVars.mySecret.dsk;
// Imports the Google Cloud client library
const { Storage } = require('@google-cloud/storage');
// Creates a client from a Google service account key
const storage = new Storage({ keyFilename: `./unifieddatabaseserviceworker.json` });
// The ID of your GCS bucket
const myBucketName = 'unified_database_etl';
const myBucket = storage.bucket(myBucketName);


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
*  Workers are named tasks that can be invoked when calling the firebase function. 
*  The worker name determines what function(s) will execute on the provided arguments.
*  The arguments should be passed as a JSON Object (defined here as "options").
*  The JSON must include any applicable key/value pairs that are required as layed out.
*/
let workers = {
    // /**
    // * getAuthToken -- Gets an authentication token for use with the zoho subscriptions api
    // * @param {None} null array of parameters to pass through to the Zoho API request: [(optional) callbackFunction].
    // * @returns If no callback function was included, returns a promise. Otherwise returns based on the callback function.
    // */
    // getAuthToken: async () => {
    //     return await getAuthToken();
    // },

    /**
    * getDealersByName -- Returns all customers from zoho books matching criteria
    * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
    * @param {string} contact_name - STRING value to search for.
    * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
    * @param {string} [url="https://www.zohoapis.com/books/v3/contacts`"] - The url for the http request
    * @param {array<string>} [urlOptions=[]] - Optional url parameters
    * @param {json} [customHeaders=null] - Optional custom headers to include
    * @param {string} [dataKey="contacts"] - The path to the desired data from http request response. Keys should be dot separated
    * @example <caption>Use dot separation to get nested keys values for return</caption>
    * root return value: dataKey:"myDesiredDataKey"
    * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
    * @param {json} [body=null] - The raw json data for the body request. 
    * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
    * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms
    * @param {number} [startingPage=1] - The page to start from.
    * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
    * @param {array<string>} [keysToDelete=[]] - Array of strings of key names to delete from results
    * @returns the requested data, typically in array json format
    * @see https://www.zoho.com/books/api/v3/contacts/#list-contacts
    */
    getFilesInBucket: async () => {
        const bucketExists = await myBucket.exists();
        const [files] = await myBucket.getFiles();

        return files

    },

    /**
    * getDealersByName -- Returns all customers from zoho books matching criteria
    * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
    * @param {string} contact_name - STRING value to search for.
    * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
    * @param {string} [url="https://www.zohoapis.com/books/v3/contacts`"] - The url for the http request
    * @param {array<string>} [urlOptions=[]] - Optional url parameters
    * @param {json} [customHeaders=null] - Optional custom headers to include
    * @param {string} [dataKey="contacts"] - The path to the desired data from http request response. Keys should be dot separated
    * @example <caption>Use dot separation to get nested keys values for return</caption>
    * root return value: dataKey:"myDesiredDataKey"
    * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
    * @param {json} [body=null] - The raw json data for the body request. 
    * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
    * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms
    * @param {number} [startingPage=1] - The page to start from.
    * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
    * @param {array<string>} [keysToDelete=[]] - Array of strings of key names to delete from results
    * @returns the requested data, typically in array json format
    * @see https://www.zoho.com/books/api/v3/contacts/#list-contacts
    */
    createOrOverwriteFile: async ({ fileObject, fileName, folderPath }) => {//fileObject === data in nljson
        if (!folderPath) {
            folderPath = "";
        }

        const file = myBucket.file(folderPath + fileName);
        // const contents = JSON.stringify(fileObject, null, 2);
        const contents = fileObject;

        await file.save(contents);
    },

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
exports.cloudStorageLandingOnCall = functions.runWith(runtimeOpts540Sec8GB).https.onCall(async data => {
    if (!data || !data.dsk || data.dsk !== mySecretdsk) {
        return `Invalid Access Code. Access Denied`;
    }

    if (!data.worker || data.worker === ``) {
        return `No worker given. Aborting.`;
    }

    try {
        return await workers[data.worker](data.args);
    }
    catch (err) {
        console.log(`err: ${err}`)
        return JSON.stringify(err);
    }
})

//#endregion

//#region Supporting Functions

//#endregion

//#region template functions
// /**
// * changeME -- Gets the requested subscription
// * @param {array} data array with the expected values of [oauth,isTesting,keysToDelete,changeME]
// * @returns a blob of data for changeME
// */
// async function changeME(data) {
//     if (!data || data.length === 0) {
//         data = ["failed", false];
//     }
//     let [oauth, isTesting, keysToDelete, changeME] = data;

//     if (!changeME) {
//         return `SubID is required for this endpoint`
//     }

//     if (!oauth || oauth === 'failed') {
//         while (!oauth || oauth === 'failed') {
//             oauth = await getAuthToken();
//         }
//     }

//     let orgID;
//     if (!isTesting || isTesting === false) {
//         orgID = liveOrg;
//     } else {
//         orgID = testOrg;
//     }

//     let headers = {
//         "Accept": "application/json",
//         "Authorization": `Zoho-oauthtoken ${oauth}`,
//         "X-com-zoho-subscriptions-organizationid": orgID,
//     };

//     let options = {
//         method: 'GET',
//         redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
//         headers: headers,
//         retries: 3,
//         retryDelay: 1000
//     };

//     var url = `https://www.zohoapis.com/books/v3/changeME`;


//     var response = await subsHelper(url, options);

//     var jsonResponse = response;
//     let returnedBlob = jsonResponse.changeME;

//     if (keysToDelete && keysToDelete.length > 0) {
//         let cleanedBlob = await shareable.deleteKeys([returnedBlob], keysToDelete);
//         return cleanedBlob;
//     } else {
//         return returnedBlob;
//     }
// }
//#endregion
