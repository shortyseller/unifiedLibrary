/* use strict*/
/* eslint-disable no-await-in-loop*/
/* eslint-disable promise/no-nesting*/
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const { URLSearchParams } = require('url'); //Necessary to encode certain calls as urlencoded json
const fetch = require('fetch-retry')(require('node-fetch'));
const shareable = require(`./shareableGlobalFunctions`);
const { sleep, deleteKeys } = require("./shareableGlobalFunctions");
const { createOrOverwriteFileAndTriggerBQImport } = require("./shareableGlobalFunctions");
const runTimeVars = functions.config().envvars;

const mySecretdsk = runTimeVars.mySecret.dsk;
const clientID = runTimeVars.zohobooks.clientid;
const clientSecret = runTimeVars.zohobooks.clientsecret;
const refreshToken = runTimeVars.zohobooks.refresh_token;
const liveOrg = runTimeVars.zohobooks.live_org;
const testOrg = runTimeVars.zohobooks.test_org;

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
    /**
    * getAuthToken -- Gets an authentication token for use with the zoho subscriptions api
    * @param {None} null array of parameters to pass through to the Zoho API request: [(optional) callbackFunction].
    * @returns If no callback function was included, returns a promise. Otherwise returns based on the callback function.
    */
    getAuthToken: async () => {
        return await getAuthToken();
    },

    /**
    * getDealersByName -- Returns all customers from zoho books matching criteria
    * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
    * @param {array<string>} exportOptions - All options necessary to export the data to the google cloud storage bucket
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
    getDealersByName: async ({ exportOptions, oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, keysToDelete, contact_name }) => {
        if (!url) url = `https://www.zohoapis.com/books/v3/contacts`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [`contact_name=${contact_name}`];
        if (!dataKey) dataKey = `contacts`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;

        let theResult = await genericBooksMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        if (exportOptions) {
            try {
                let response = await createOrOverwriteFileAndTriggerBQImport({
                    transferConfigIDPath: "zohoBooks/incrementalOrgs",
                    bucketName: exportOptions.bucketName,
                    fileObject: theResult.map(obj => JSON.stringify(obj).replace(/-0400/g, '').replace(/-0500/g, '').replace(/-0600/g, '').replace(/-0700/g, '')).join("\n"),
                    fileName: exportOptions.fileName,
                    folderPath: exportOptions.folderPath
                })
                return { ...response }
            } catch (err) {
                console.error(`Error in createOrOverwriteFileAndTriggerBQImport: ${err.message}`);
                return {
                    error: `Error in createOrOverwriteFileAndTriggerBQImport: ${err.message}`
                }
            }
        }
        if (!keysToDelete || keysToDelete.length === 0) {
            return theResult;
        } else {
            let cleanedResult = shareable.deleteKeys(theResult, keysToDelete);
            return cleanedResult;
        }
    },

    /**
     * listInvoices -- lists all of the invoices
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {array<string>} urlOptions[] - This endpoint requires at least one urlOption to limit the number of results. See zoho documenation
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/books/v3/invoices"] - The url for the http request
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="invoices"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * root return value: dataKey:"myDesiredDataKey"
     * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body] - The raw json data for the body request. 
     *      See documentation from zoho subs for all required keys
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @param {array<string>} [keysToDelete=[]] - Array of strings of key names to delete from results
     * @returns the requested data, typically in array json format
     * @see https://www.zoho.com/books/api/v3/invoices/#list-invoices
     */
    listInvoices: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, keysToDelete }) => {
        if (!url) url = `https://www.zohoapis.com/books/v3/invoices`;
        if (!urlOptions || urlOptions.length === 0) {
            //Must do something to limit the number of returned subscriptions.
            //Forcing today's date
            let tmpDate = new Date();
            let dateFormatted = shareable.formatDate(tmpDate);
            urlOptions = [`date=${dateFormatted}`];
        }
        if (!dataKey) dataKey = `invoices`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;

        let theResult = await genericBooksMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        if (!keysToDelete || keysToDelete.length === 0) {
            return theResult;
        } else {
            let cleanedResult = shareable.deleteKeys(theResult, keysToDelete);
            return cleanedResult;
        }
    },

    /**
     * createInvoice -- Creates an invoice with supplied info
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} customer_id - The ID for the dealer you want to create an invoice for
     * @param {json} body - The raw json data for the invoice request. 
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/books/v3/invoices"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="invoice"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * root return value: dataKey:"myDesiredDataKey"
     * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @param {array<string>} [keysToDelete=[]] - Array of strings of key names to delete from results
     * @returns the requested data, typically in array json format
     * @see https://www.zoho.com/books/api/v3/invoices/#create-an-invoice
     */
    createInvoice: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, keysToDelete, customer_id }) => {
        if (!body) return 'Required body is not supplied.';
        if (!customer_id) return `Required customer_id not provided.`;
        if (!url) url = `https://www.zohoapis.com/books/v3/invoices`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `invoice`;
        if (!method) method = 'POST';
        if (!singlePull) singlePull = true;

        let theResult = await genericBooksMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);

        if (!keysToDelete || keysToDelete.length === 0) {
            return theResult;
        } else {
            let cleanedResult = shareable.deleteKeys([theResult], keysToDelete);
            return cleanedResult;
        }
    },

    /**
     * uploadAttachmentToInvoice -- Uploads an attachment to the invoice
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} invoice_id - the ID for the invoice to attach a document to.
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/books/v3/invoices/${invoice_id}/attachment"] - The url for the http request
     * @param {array<string>} [urlOptions=[`can_send_in_mail=true`]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get deep nested keys/values returned</caption>
     * root return value: dataKey:"myDesiredDataKey"
     * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body={"theFile":theActualFile,"theFileName":"theFileName"}] - The raw json data for the body request.
     * @example <caption>Body should have file data key as well as filename key</caption>
     * {
     * 	"theFile": theActualFile,
     * 	"theFileName": "theFileName"
     * }
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @param {array<string>} [keysToDelete=[]] - Array of strings of key names to delete from results
     * @returns the [resultMessage](https://www.zoho.com/books/api/v3/invoices/#add-attachment-to-an-invoice)
     */
    uploadAttachmentToInvoice: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, keysToDelete, invoice_id }) => {
        if (!body || !body.theFile || !body.theFileName) return `Required attachment data in body not supplied.`;
        if (!invoice_id) return 'Required invoice_id not supplied.';
        if (!url) url = `https://www.zohoapis.com/books/v3/invoices/${invoice_id}/attachment`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [`can_send_in_mail=true`];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'POST';
        if (!singlePull) singlePull = true;
        if (!keysToDelete) keysToDelete = [];
        const FormData = require("form-data");
        var formdata = new FormData();
        formdata.append("attachment", body.theFile, body.theFileName);
        body = null;
        body = formdata;

        let theResult = await genericBooksMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        if (!keysToDelete || keysToDelete.length === 0) {
            return theResult;
        } else {
            let cleanedResult = shareable.deleteKeys(theResult, keysToDelete);
            return cleanedResult;
        }
    },

    /**
     * markInvoiceAsDraft -- Marks an invoice as a draft.
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} invoice_id - the ID for the invoice to mark as draft.
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/books/v3/invoices/${invoice_id}/status/draft"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * root return value: dataKey:"myDesiredDataKey"
     * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none.
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL pages.
     * @param {array<string>} [keysToDelete=[]] - Array of strings of key names to delete from results
     * @returns the [resultMessage](https://www.zoho.com/books/api/v3/invoices/#mark-as-draft)
     */
    markInvoiceAsDraft: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, keysToDelete, invoice_id }) => {
        if (!invoice_id) return 'Required invoice_id not supplied.';
        if (!url) url = `https://www.zohoapis.com/books/v3/invoices/${invoice_id}/status/draft`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'POST';
        if (!singlePull) singlePull = true;

        let theResult = await genericBooksMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        if (!keysToDelete || keysToDelete.length === 0) {
            return theResult;
        } else {
            let cleanedResult = shareable.deleteKeys(theResult, keysToDelete);
            return cleanedResult;
        }
    },

    /**
     * updateInvoice -- Updates an invoice with the new data supplied
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} invoice_id - the ID for the invoice to mark as draft.
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/books/v3/invoices/${invoice_id}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * root return value: dataKey:"myDesiredDataKey"
     * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="PUT"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body={newInvoiceData}] - The raw json data for the body request. 
     * @example <caption>Body should contain json object with key/value pairs</caption>
     * {
     * 	"customer_id": 982000000567001,
     * 	"contact_persons": [
     * 		"982000000870911",
     * 		"982000000870915"
     * 	],
     * 	"invoice_number": "INV-00003",
     * 	"custom_fields": [{
     * 		"customfield_id": "46000000012845",
     * 		"value": "Normal"
     * 	}],
     * 	"line_items": [{
     * 		"item_id": 982000000030049,
     * 		"name": "Hard Drive",
     * 		"description": "500GB, USB 2.0 interface 1400 rpm, protective hard case.",
     * 		"item_order": 1,
     * 		"rate": 120,
     * 		"quantity": 1,
     * 		"unit": " ",
     * 		"discount_amount": 0,
     * 	}],
     * }
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @param {array<string>} [keysToDelete=[]] - Array of strings of key names to delete from results
     * @returns the [resultMessage](https://www.zoho.com/books/api/v3/invoices/#update-an-invoice)
     */
    updateInvoice: async ({ oauth, isTesting, url, customHeaders, urlOptions, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, keysToDelete, invoice_id }) => {
        if (!invoice_id) return 'Required invoice_id not supplied.';
        if (!url) url = `https://www.zohoapis.com/books/v3/invoices/${invoice_id}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'PUT';
        if (!singlePull) singlePull = true;

        let theResult = await genericBooksMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        if (!keysToDelete || keysToDelete.length === 0) {
            return theResult;
        } else {
            let cleanedResult = shareable.deleteKeys(theResult, keysToDelete);
            return cleanedResult;
        }
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
 * @param {Object} data The data to pass to the worker and any relevant options
 * @example
 * data: {
 *  worker: string, //name of the worker
 *  args: Array<*>, //array of arguments to the worker
 *  dsk: string     //mySecret's dsk
 * }
 * @param {Object} args.exportOptions All options necessary to export the data to the google cloud storage bucket
 * @example
 * exportOptions: { //optional, if not specified returns data directly
 *      bucketName: string, //name of gcs storage bucket
 *      fileName: string, //name of the file to export to in cloud storage, including file extension
 *      folderPath: string //path to export to in cloud storage
 *  }
*/
exports.zohoBooksLandingOnCall = functions.runWith(runtimeOpts540Sec8GB).https.onCall(async data => {
    if (!data || !data.dsk || data.dsk !== mySecretdsk) {
        return `Invalid Access Code. Access Denied`;
    }

    if (!data.worker || data.worker === ``) {
        return `No worker given. Aborting.`;
    }

    try {
        let result = await workers[data.worker](data.args);

        return shareable.deleteKeys(result, data.keysToDelete);

    }
    catch (err) {
        console.log(`err: ${err}`)
        return JSON.stringify(err);
    }
})

//#endregion

//#region Supporting Functions

/**
* Requests a fresh auth token for zoho services
* @param {None}
* @returns a useable auth token scoped for use with zoho subscriptions
*/
async function getAuthToken() {
    let options = {
        method: 'POST',
        redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
        headers: {
            "Content-Type": "application/json"
        },
        retries: 3,
        retryDelay: 1000
    }

    let theToken = await fetch(`https://accounts.zoho.com/oauth/v2/token?refresh_token=${refreshToken}&client_id=${clientID}&client_secret=${clientSecret}&grant_type=refresh_token`, options)
        .then(response => response.json())
        .catch(error => {
            console.log('error', error);
            return {
                "access_token": "failed"
            }
        });
    return theToken.access_token;
}

/**
* subsHelper -- Performs simple get request with the supplied data
* @param {string} url string URL
* @param {JSON} options json object with headers and other options
* @param {string} dataKey String value representing the key value location of desired data
* @returns a blob of data for changeME
*/
const subsHelper = async (url, options, dataKey) => {
    if (!dataKey) dataKey = `message`;

    return fetch(url, options)
        .then(response => response.json())
        .then((result) => {
            if (dataKey.toString().indexOf(`.`) >= 0) {
                let theKeys = dataKey.split('.');
                let a;
                let tmpData;
                for (a = 0; a < theKeys.length; a++) {
                    tmpData = result[theKeys[a]];
                    result = tmpData;
                }
                return tmpData;
            } else {
                return result[dataKey];
            }
        })
        .catch((error) => {
            return {
                "code": 0,
                "message": error
            }
        });
}

/**
* genericBooksMethod -- Generic push/put/delete/get method
* @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
* @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
* @param {string} url The url for the http request
* @param {array<string>} urlOptions Optional url parameters
* @param {string} dataKey The path to the desired data from http request response
* @param {string} method The desired http method -- defaults to GET in case of no method
* @param {json} [body=null] - The raw json data for the body request. 
* @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
* @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
* @param {number} [startingPage=1] - The page to start from.
* @param {number} pageCount The total number of pages to fetch. Leave null value for default 1000 (all)
* @returns the requested data, typically in array json format
*/
async function genericBooksMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount) {
    if (!oauth || oauth === 'failed') {
        while (!oauth) {
            oauth = await getAuthToken();
        }
    }

    let orgID;
    if (!isTesting || isTesting === false) {
        orgID = liveOrg;
    } else {
        orgID = testOrg;
    }
    urlOptions.push(`organization_id=${orgID}`)
    let headers = {
        "Accept": "application/json",
        "Authorization": `Zoho-oauthtoken ${oauth}`,
        "X-com-zoho-subscriptions-organizationid": orgID,
    };


    if (!method) method = 'GET';

    let options = {
        method: method,
        redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
        headers: headers,
        retries: 3,
        retryDelay: 1000
    };

    if (customHeaders) {
        let a;
        for (a in customHeaders) {
            options["headers"][a] = customHeaders[a]
        }
        delete options["headers"]["Accept"];
        if (body) options["body"] = body;
    } else {
        if (body) options["body"] = JSON.stringify(body);
    }

    if (singlePull && singlePull === true) {
        try {
            return await subsHelper(`${url}${url.includes('?') ? '&' : '?'}${urlOptions.join('&')}`, options, dataKey);
        }
        catch (err) {
            //Most likely issue is that the urlOptions is empty
            return await subsHelper(url, options, dataKey);
        }
    } else {
        if (!rateLimit) rateLimit = 1000;
        if (!startingPage) startingPage = 1;
        return await shareable.zohoOffsetPagination(url, urlOptions, options, dataKey, true, rateLimit, startingPage, pageCount);
    }
}

// async function emailInvoice(data, zohoAuthToken) {

//     while (!zohoAuthToken) {
//         const zohoAuthTokenAttempt = await zohobooksOAuth.internalGetZohoToken({
//             dsk: mySecretdsk,
//             oauth: zohoAuthToken
//         });
//         zohoAuthToken = zohoAuthTokenAttempt;
//     }
//     var id = data.invoice_id;
//     var recipients = data.recipients;
//     console.log(recipients)
//     var subject = data.subject;
//     var body = data.body;

//     var url = `https://www.zohoapis.com/books/v3/invoices/${id}/email`;
//     var headers = { "Accept": "application/json", "Authorization": `Zoho-oauthtoken ${zohoAuthToken}`, "X-com-zoho-subscriptions-organizationid": "667599093" };
//     var options = {
//         "method": "POST",
//         "headers": headers,
//         "contentType": "application/json",
//         "muteHttpExceptions": false,
//         "body": JSON.stringify({
//             "to_mail_ids": recipients,
//             "subject": subject,
//             "body": body
//         })
//     };

//     return await fetch2(url, options)
//         .then(res => res.json())
//         .then(res => {
//             return res;
//         });

// }

// async function subsupdateInvoice(sid, contactPersons, oauth) {
//     let zohoAuthToken;
//     if (!oauth) {
//         while (!zohoAuthToken) {
//             const zohoAuthTokenAttempt = await zohoBooksOAuth.internalGetZohoToken({
//                 dsk: mySecretdsk,
//                 oauth: oauth,
//                 isTesting: false
//             });
//             zohoAuthToken = zohoAuthTokenAttempt;
//         }
//     } else {
//         zohoAuthToken = oauth;
//     }
//     var headers = {
//         "Accept": "application/json",
//         "Authorization": `Zoho-oauthtoken ${zohoAuthToken}`,
//         "X-com-zoho-subscriptions-organizationid": "667599093"
//     };
//     var options2 = {
//         method: 'PUT',
//         redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
//         headers: headers,
//         retries: 3,
//         retryDelay: 1000,
//         body: JSON.stringify({
//             "contact_persons": contactPersons
//         })
//     };



//     var BACKEND_URL2 = `https://www.zohoapis.com/books/v3/invoices/${sid}?organization_id=667599093`;

//     var thisResult = await subsHelper(BACKEND_URL2, options2)
//     console.log(thisResult)
//     return thisResult;

// }

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
