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
const paylianceAuthBlob = runTimeVars.payliance.auth;
const paylianceAuth = {
    "UserName": paylianceAuthBlob.username,
    "SecretAccessKey": paylianceAuthBlob.secretaccesskey
};


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
    * addDealer -- Adds a dealer to Paylinace. **NOTE** Check to see if they exist FIRST
    * @param {string} primaryFirstName - The dealership owners' first name
    * @param {string} primaryLastName - The dealership owners' last name
    * @param {string} companyName - The company name, spelled EXACTLY how it is spelled in zoho subscriptions
    * @param {string} [url="https://gatewayapi.payliance.com/api/ReceivablesProCustomer/CreateCustomer"] - The url for the http request
    * @param {string} [dataKey="Response"] - The path to the desired data from http request response. Keys should be dot separated
    * @example <caption>Use dot separation to get nested keys values for return</caption>
    * root return value: dataKey:"myDesiredDataKey"
    * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
    * @param {json} [body=null] - The raw json data for the body request.
    * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
    * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms
    * @param {number} [startingPage=1] - The page to start from.
    * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
    * @param {array<string>} [keysToDelete=[]] - Array of strings of key names to delete from results
    * @returns the requested data, typically in array json format
    */
    addDealer: async ({ primaryFirstName, primaryLastName, companyName, url, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, keysToDelete }) => {
        if ((!primaryFirstName || primaryFirstName === '') || (!primaryLastName || primaryLastName === '') || (!companyName || companyName === '')) return `Required information was not provided.`
        if (!url) url = `https://gatewayapi.payliance.com/api/ReceivablesProCustomer/CreateCustomer`;
        if (!dataKey) dataKey = `Response`;
        if (!method) method = 'POST';
        if (!singlePull) singlePull = true;
        if (!body || body === '') {
            let requestBody = {
                "FirstName": primaryFirstName,
                "LastName": primaryLastName,
                "Company": companyName,
                "ShippingSameAsBilling": true
            }
            body = requestBody;
        }

        let theResult = await genericPaylianceMethod(url, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        if (!keysToDelete || keysToDelete.length === 0) {
            return theResult;
        } else {
            let cleanedResult = shareable.deleteKeys(theResult, keysToDelete);
            return cleanedResult;
        }
    },

    /**
    * checkIfExistingCustomer -- Checks to see if the supplied Dealer Name is already in Payliance.
    * @param {string} companyName - The company name, spelled EXACTLY how it is spelled in zoho subscriptions
    * @param {string} [url="https://gatewayapi.payliance.com/api/ReceivablesProCustomer/Customers"] - The url for the http request
    * @param {string} [dataKey="Response"] - The path to the desired data from http request response. Keys should be dot separated
    * @example <caption>Use dot separation to get nested keys values for return</caption>
    * root return value: dataKey:"myDesiredDataKey"
    * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
    * @returns the requested data, in json format
    */
    checkIfExistingCustomer: async ({ companyName, url, dataKey, method }) => {
        if (!companyName || companyName === '') return `Required information was not provided.`;
        if (!url) url = `https://gatewayapi.payliance.com/api/ReceivablesProCustomer/Customers`;
        if (!dataKey) dataKey = `Response`;
        if (!method) method = 'POST';

        var headers = {
            "Content-Type": "application/json"
        };

        let page = 0, totalPages = 100;
        let theCompany = [];
        while (page < totalPages) {
            page += 1;
            let raw = JSON.stringify({
                "SortBy": 0,
                "Direction": 0,
                "Page": page,
                "PageSize": 200,
                "Lite": true,
                "Auth": paylianceAuth
            });

            let requestOptions = {
                method: 'POST',
                headers: headers,
                body: raw,
                redirect: 'follow',
                retries: 3,
                retryDelay: 1000
            };
            let response = await fetch(url, requestOptions)
                .then(response => response.json())
                .then(response => {
                    return response;
                });

            totalPages = response.Response.TotalPages;

            var i;

            for (i in response.Response.Items) {
                if (response.Response.Items[i].Company.toString() === companyName) {
                    theCompany = response.Response.Items[i];
                    break;
                }
            }
        }
        if (theCompany.length === 0) {
            console.log(`No company found??`)
            return 'NotFound'
        } else {
            console.log(`Returning ${JSON.stringify(theCompany)}`)
            return theCompany;
        }
    },

    /**
    * checkForACHBlob -- Checks to see if the supplied Dealer ID has an ACH blob.
    * @param {number} dealersPaylianceID - The ID of the customer in Payliance. Can be gotten by the 'checkIfExistingCustomer' worker function
    * @param {string} [url="https://gatewayapi.payliance.com/api/ReceivablesProCustomer/AchAccounts`"] - The url for the http request
    * @param {string} [dataKey="Response"] - The path to the desired data from http request response. Keys should be dot separated
    * @example <caption>Use dot separation to get nested keys values for return</caption>
    * root return value: dataKey:"myDesiredDataKey"
    * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
    * @returns the requested data, in json format
    */
    checkForACHBlob: async ({ dealersPaylianceID, url, dataKey, method }) => {
        if (!dealersPaylianceID || dealersPaylianceID === '') return `Required information was not provided.`;
        if (!url) url = `https://gatewayapi.payliance.com/api/ReceivablesProCustomer/AchAccounts`;
        if (!dataKey) dataKey = `Response`;
        if (!method) method = 'POST';
        var headers = {
            "Content-Type": "application/json"
        };

        var raw = JSON.stringify({
            "Request": dealersPaylianceID,
            "Auth": paylianceAuth
        });

        var requestOptions = {
            method: 'POST',
            headers: headers,
            body: raw,
            redirect: 'follow',
            retries: 3,
            retryDelay: 1000
        };
        var response = await fetch(url, requestOptions)
            .then(response => response.json())
            .then(response => {
                return response;
            });
        if (response.Response.length === 0) {
            return 'NoACH';
        } else {
            return response.Response;
        }
    },

    /**
    * collectChargeViaACH -- Collects the invoice amount charge for the given ach account
    * @param {number} achACCID - The ID of the ACH Blob. Can be retrieved with the 'checkForACHBlob' worker function.
    * @param {number} chargeAmount - The amount to charge to ach.
    * @param {string} [url="https://gatewayapi.payliance.com/api/ReceivablesProPayment/CreatePayment"] - The url for the http request
    * @param {string} [dataKey="Response"] - The path to the desired data from http request response. Keys should be dot separated
    * @example <caption>Use dot separation to get nested keys values for return</caption>
    * root return value: dataKey:"myDesiredDataKey"
    * nested return value: dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
    * @returns the requested data, in json format
    */
    collectChargeViaACH: async ({ achACCID, chargeAmount, url, dataKey, method }) => {
        if ((!achACCID || achACCID === '') || (!chargeAmount || chargeAmount === '')) return `Required information was not provided.`;
        if (!url) url = `https://gatewayapi.payliance.com/api/ReceivablesProPayment/CreatePayment`;
        if (!dataKey) dataKey = `Response`;
        if (!method) method = 'POST';
        var headers = {
            "Content-Type": "application/json"
        };

        var raw = JSON.stringify({
            "Request": {
                "AccountId": achACCID,
                "Amount": chargeAmount,
                "PaymentSubType": 0
            },
            "Auth": paylianceAuth
        });

        var requestOptions = {
            method: 'POST',
            headers: headers,
            body: raw,
            redirect: 'follow',
            retries: 3,
            retryDelay: 1000
        };

        var response = await fetch(url, requestOptions)
            .then(response => response.json())
            .then(response => {
                return response;
            });

        if (response.Success === false || response.Response.IsDecline === true) {
            var reason = 'PaymentFailed ' + response.Message.toString();
            return { Message: reason }

        } else {
            var paymentid = response.Response.Id;
            var ammounter = response.Response.Amount;
            var InvoiceNumber = response.Response.number;
            var cuscompany = response.Response.CustomerCompany;
            var tracenum = response.Response.TraceNumber;

            return { Message: 'PaymentSuccess', paymentid: paymentid, ammounter: ammounter, InvoiceNumber: InvoiceNumber, cuscompany: cuscompany, tracenum: tracenum };
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
*/
exports.paylianceLandingOnCall = functions.runWith(runtimeOpts540Sec8GB).https.onCall(async data => {
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


/**
* fetchHelper -- Performs simple get request with the supplied data
* @param {string} url string URL
* @param {JSON} options json object with headers and other options
* @param {string} dataKey String value representing the key value location of desired data
* @returns a blob of data for changeME
*/
const fetchHelper = async (url, options, dataKey) => {
    if (!dataKey) dataKey = `Response`;

    return fetch(url, options)
        .then(response => response.json())
        .then((result) => {
            console.log(result)
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
* @param {string} url The url for the http request
* @param {string} dataKey The path to the desired data from http request response
* @param {string} method The desired http method -- defaults to GET in case of no method
* @param {json} [body=null] - The raw json data for the body request
* @returns the requested data, typically in array json format
*/
async function genericPaylianceMethod(url, dataKey, method, body) {
    let headers = {
        "Content-Type": "application/json"
    };

    if (!method) method = 'GET';

    let options = {
        method: method,
        redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
        headers: headers,
        retries: 3,
        retryDelay: 1000
    };

    if (body) {
        options["body"] = JSON.stringify({
            "Request": body,
            "Auth": paylianceAuth
        });
    } else {
        options["body"] = JSON.stringify({
            "Auth": paylianceAuth
        });
    }

    return await fetchHelper(url, options, dataKey);
}
//#endregion
