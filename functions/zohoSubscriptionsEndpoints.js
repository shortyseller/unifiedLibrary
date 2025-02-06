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
const clientID = runTimeVars.zohosubs.clientid;
const clientSecret = runTimeVars.zohosubs.clientsecret;
const refreshToken = runTimeVars.zohosubs.refresh_token;
const liveOrg = runTimeVars.zohosubs.live_org;
const testOrg = runTimeVars.zohosubs.test_org;

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
    * @param {None} null
    * @returns oauthToken <string>
    */
    getAuthToken: async () => {
        return await getAuthToken();
    },

    /**
    * getSingleCustomer -- Returns a single customer from zoho subs.
    * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
    * @param {string} customerID - STRING value of customer ID.
    * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
    * @param {string} [url="https://www.zohoapis.com/billing/v1/customers/${customerID}"] - The url for the http request
    * @param {array<string>} [urlOptions=[]] - Optional url parameters
    * @param {json} [customHeaders=null] - Optional custom headers to include
    * @param {string} [dataKey="customer"] - The path to the desired data from http request response. Keys should be dot separated
    * @example <caption>Use dot separation to get nested keys values for return</caption>
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
    * @param {json} [body=null] - The raw json data for the body request. 
    * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
    * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms
    * @param {number} [startingPage=1] - The page to start from.
    * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
    * @returns the [{customer}](https://www.zoho.com/subscriptions/api/v1/customers/#retrieve-a-customer)
    */
    getSingleCustomer: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, customerID }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/customers/${customerID}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `customer`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
    * getAllCustomers -- Gets all customers (dealers) from the zoho subs api.
    * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
    * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
    * @param {string} [url="https://www.zohoapis.com/billing/v1/customers"] - The url for the http request
    * @param {array<string>} [urlOptions=["filter_by=Status.All"]] - Optional url parameters
    * @param {JSON} [customHeaders=[]] - Optional custom headers to include
    * @param {string} [dataKey="customers"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
    * @param {json} [body=null] - The raw json data for the body request. 
    * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
    * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
    * @param {number} [startingPage=1] - The page to start from.
    * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
    * @returns the [[{customers}]](https://www.zoho.com/subscriptions/api/v1/customers/#list-all-customers)
    */
    getAllCustomers: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/customers`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [`filter_by=Status.All`];
        if (!dataKey) dataKey = `customers`;
        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult, transferConfigIDPath: `zohoSubscriptions/incrementalCustomers` };
    },

    /**
     * createCustomer -- creates a new customer (dealer) in subscriptions.
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/customers"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="customer"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body={dealersInfo}] - The raw json data for the body request. - See [documentation](https://www.zoho.com/subscriptions/api/v1/customers/#create-a-customer) from zoho subs for all required keys
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [{customer}](https://www.zoho.com/subscriptions/api/v1/customers/#create-a-customer)
     */
    createCustomer: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/customers`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `customer`;
        if (!method) method = 'POST';
        singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * getSingleSubscription -- Gets a single subscription from zoho by subscription id supplied 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} subscriptionID - The subscription ID for this endpoint
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="subscription"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms - Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [{subscription}](https://www.zoho.com/subscriptions/api/v1/subscription/#retrieve-a-subscription)
     */
    getSingleSubscription: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, subscriptionID }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `subscription`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * getAllSubscriptions -- Gets all subscriptions from the zoho subs api. 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/subscriptions"] - The url for the http request
     * @param {array<string>} [urlOptions=[`filter_by=SubscriptionStatus.All`]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="subscriptions"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [[{subscriptions}]](https://www.zoho.com/subscriptions/api/v1/subscription/#list-all-subscriptions)
     */
    getAllSubscriptions: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/subscriptions`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [`filter_by=SubscriptionStatus.All`];
        if (!dataKey) dataKey = `subscriptions`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;
        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult, transferConfigIDPath: `zohoSubscriptions/incrementalSubscriptions` };
    },

    /**
    * createSubscription -- creates a new subscription
    * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
    * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
    * @param {string} [url="https://www.zohoapis.com/billing/v1/subscriptions"] - The url for the http request
    * @param {array<string>} [urlOptions=[]] - Optional url parameters
    * @param {json} [customHeaders=null] - Optional custom headers to include
    * @param {string} [dataKey="subscription"] - The path to the desired data from http request response. Keys should be dot separated
    * @example <caption>Use dot separation to get nested keys values for return</caption>
    * To get top level data - dataKey:"myDesiredDataKey"
    * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
    * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
    * @param {json} body - The raw json data for the body request.
    * @example <caption>See [documenation](https://www.zoho.com/subscriptions/api/v1/subscription/#create-a-subscription) provided by zoho subscriptions for all required fields in body parameter</caption>
    * {
    *     "customer": {
    *          "display_name": "Bowman Furniture",
    *         "salutation": "Mr.",
    *         "first_name": "Benjamin",
    *         "last_name": "George",
    *         "email": "benjamin.george@bowmanfurniture.com",
    *         "company_name": "Bowman Furniture",
    *         "billing_address": {
    *             "attention": "Benjamin George",
    *             "street": "Harrington Bay Street",
    *             "city": "Salt Lake City",
    *             "state": "CA",
    *             "country": "U.S.A",
    *             "zip": 92612,
    *             "fax": 4527389
    *         }
    *      },
    *     "add_to_unbilled_charges": true
    * }
    * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
    * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
    * @param {number} [startingPage=1] - The page to start from.
    * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
    * @returns the [{theCreatedSubscription}](https://www.zoho.com/subscriptions/api/v1/subscription/#create-a-subscription)
    */
    createSubscription: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!body) return `Request must include a body with required args.`
        if (!url) url = `https://www.zohoapis.com/billing/v1/subscriptions`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `subscription`;
        if (!method) method = 'POST';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * cancelSubscription -- cancels the subscription, immediate is default, end of term is optional 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} subscriptionID - The subscription ID for this endpoint
     * @param {boolean} [cancel_at_end=false] Should the subscription be cancelled at end of term or immediately
     * @param {json} [customHeaders={"Content-Type": "application/x-www-form-urlencoded"}] - Optional custom headers to include
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}/cancel?cancel_at_end=${cancel_at_end}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body={"churn_message_id": "1356618000000763005"} || {"result": "Customer opted to not continue due to whatever reason."}] - The raw json data for the body request. 
     * @example <caption>Body JSON must contain either churn_message_id key --OR-- reason key</caption>
     *   If the reason for cancellation is a preformatted template one then use churn_message_id
     *   {
     *      churn_message_id: "${reasonForCancellationID}"
     *   }
     *   If the reason for cancellation is 'Other' then use reason
     *   {
     *      reason:"${short string reason for cancel}"
     *   }
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [resultMessage](https://www.zoho.com/subscriptions/api/v1/subscription/#cancel-a-subscription)
     */
    cancelSubscription: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, subscriptionID, cancel_at_end }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}/cancel?cancel_at_end=${cancel_at_end}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'POST';
        if (!cancel_at_end) cancel_at_end = false;
        if (!singlePull) singlePull = true;
        if (!customHeaders) customHeaders = {
            "Content-Type": "application/x-www-form-urlencoded"
        };
        if (!body) {
            return `churn_message_id or reason is required`;
        } else {
            body = JSON.stringify(body)
        }

        const urlencoded = new URLSearchParams();
        urlencoded.append("JSONString", body);
        body = null;
        body = urlencoded;



        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * deleteSubscription -- deletes a subscription completely 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} subscriptionID - The subscription ID for this endpoint
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="DELETE"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [resultMessage](https://www.zoho.com/subscriptions/api/v1/subscription/#delete-a-subscription)
     */
    deleteSubscription: async ({ oauth, isTesting, url, customHeaders, urlOptions, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, subscriptionID }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'DELETE';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * notateSubscription -- Add a note to a single subscription     
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} subscriptionID - The subscription ID for this endpoint
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}/notes"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} body - The raw json data for the body request.  NOTES should be in description key
     * @example <caption>Body should contain json object with key/value pair:</caption>
     * {
     *      description:"The note for subscription."
     * }
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [resultMessage](https://www.zoho.com/subscriptions/api/v1/subscription/#add-a-note)
     */
    notateSubscription: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, subscriptionID }) => {
        if (!body || !body.description) return `Notes are required. Ensure notes are nested under body[description].`;
        if (!url) url = `https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}/notes`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'POST';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * getCreditCardsForCustomer -- Gets the specified customers credit card blobs 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} customerID - The customer ID for this endpoint
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/customers/${customerID}/cards"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="cards"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none.
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL pages.
     * @returns the [[{customerCards}]](https://www.zoho.com/subscriptions/api/v1/cards/#list-all-active-credit-cards-of-a-customer)
     */
    getCreditCardsForCustomer: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, customerID }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/customers/${customerID}/cards`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `cards`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * updateSubscriptionWithNewCC -- Updates a subscription with a different credit card 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} subscriptionID - The subscriptionID for this endpoint
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}/card"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} body - The raw json data for the body request. 
     * @example <caption>Body should contain json object with key/value pairs: card_id and auto_collect</caption>
     * {
     *     "card_id": "9030000079226",
     *     "auto_collect": true
     * }
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [resultMessage](https://www.zoho.com/subscriptions/api/v1/subscription/#update-card)
     */
    updateSubscriptionWithNewCC: async ({ oauth, isTesting, url, customHeaders, urlOptions, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, subscriptionID }) => {
        if (!body || !body.card_id || !body.auto_collect) return `Body should contain json object with key/value pairs: card_id and auto_collect`;
        if (!url) url = `https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}/card`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'POST';
        singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * deleteCardOnSubscription -- Deletes a card from a subscription.
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned.
     * @param {string} subscriptionID - The subscriptionID for this endpoint
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}/card"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="DELETE"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [resultMessage](https://www.zoho.com/subscriptions/api/v1/subscription/#remove-card)
     */
    deleteCardOnSubscription: async ({ oauth, isTesting, url, customHeaders, urlOptions, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, subscriptionID }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/subscriptions/${subscriptionID}/card`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'DELETE';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * getAllInvoices - Gets all invoices from the zoho subs api.
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} invoiceViewID - STRING value of invoice view ID
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/invoices"] - The url for the http request
     * @param {array<string>} [urlOptions=["per_page=200", "sort_column=invoice_date", "sort_order=D"]] - Optional url parameters
     * @example <caption>Optional Controls</caption>
     * ["per_page=200", "sort_column=invoice_date", "sort_order=D"]
     * @example <caption>If an invoiceViewID is specified then it will only receive invoices from that view.</caption>
     * To list invoices for a particular subscription or customer append another urlOption in the request:
     * ["subscription_id={subscription_id}"] - OR - ["customer_id={customer_id}"]
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="invoices"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [[{invoices}]](https://www.zoho.com/subscriptions/api/v1/invoices/#list-all-invoices)
     */
    getAllInvoices: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, invoiceViewID }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/invoices`;
        if (!urlOptions || urlOptions.length === 0) {
            urlOptions = ["per_page=200", "sort_column=invoice_date", "sort_order=D"];
            if (invoiceViewID) urlOptions.push(`customview_id=${invoiceViewID}`);
        }
        if (!singlePull) singlePull = false;
        if (!dataKey) dataKey = `invoices`;
        if (!method) method = 'GET';

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult, transferConfigIDPath: `zohoSubscriptions/incrementalInvoices` };
    },

    /**
     * getSingleInvoice -- Gets a single invoice 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} invoiceID - STRING value of invoice view ID
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/invoices/${invoiceID}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="invoice"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [{requestedInvoice}](https://www.zoho.com/subscriptions/api/v1/invoices/#retrieve-an-invoice)
     */
    getSingleInvoice: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, invoiceID }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/invoices/${invoiceID}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `invoice`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * emailSingleInvoice -- Emails an invoice from zoho subscriptions to the recipients specified 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} invoiceID - STRING value of invoiceID to email
     * @param {json} body - The raw json data for the body request.
     * @example <caption>Expecting: { "to_mail_ids": [recipients], "subject": subject, "body": body }</caption>
     * Optionally include [cc_mail_ids]
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/invoices/${invoiceID}/email"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="message"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="POST"] - The desired http method -- defaults to endpoint specific method if none
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [resultMessage](https://www.zoho.com/subscriptions/api/v1/invoices/#email-an-invoice)
     */
    emailSingleInvoice: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, invoiceID }) => {
        if (!invoiceID && !url) return `invoiceID is a required parameter`;
        if (!body || !body.to_mail_ids || body.to_mail_ids.length === 0) return `Body parameters require an array of to_mail_ids recipient`;
        if (!body || !body.subject) return `Body parameters require a subject`;
        if (!body || !body.body) return `Body parameters require an email body`;
        if (!url) url = `https://www.zohoapis.com/billing/v1/invoices/${invoiceID}/email`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `message`;
        if (!method) method = 'POST';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * getReasonsForCancellation - Gets all of our predefined reasons for cancellation 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/settings/preferences/churnmessages"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="churn_messages_settings.churn_messages"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [[{churn_messages}]](https://www.zoho.com/subscriptions/api/v1/settings/#retrieve-churn-message-preferences)
     */
    getReasonsForCancellation: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/settings/preferences/churnmessages`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `churn_messages_settings.churn_messages`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult, transferConfigIDPath: `zohoSubscriptions/incrementalReasonsForCancellation` };
    },

    /**
     * getAllProducts -- Gets all of our root Products from zoho subscriptions 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/products"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="products"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [[{products}]](https://www.zoho.com/subscriptions/api/v1/products/#list-of-all-products)
     */
    getAllProducts: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/products`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `products`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult, transferConfigIDPath: `zohoSubscriptions/incrementalProducts` };
    },

    /**
     * getSpecificProduct -- Gets the requested product from zoho subs 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} product_id - the ID of the product you would like to retrieve
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/products/${product_id}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="product"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [{product}](https://www.zoho.com/subscriptions/api/v1/products/#retrieve-a-product)
     */
    getSpecificProduct: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, product_id }) => {
        if (!product_id && !url) return `product_id is required`
        if (!url) url = `https://www.zohoapis.com/billing/v1/products/${product_id}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `product`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * getAllPlans -- Gets all of our root Plans from zoho subscriptions 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/plans"] - The url for the http request
     * @param {array<string>} [urlOptions=["filter_by.ALL"]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="plans"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [[{plans}]](https://www.zoho.com/subscriptions/api/v1/products/#list-all-plans)
     */
    getAllPlans: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/plans`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = ["filter_by.ALL"];
        if (!dataKey) dataKey = `plans`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult, transferConfigIDPath: `zohoSubscriptions/incrementalPlans` };
    },

    /**
     * getSpecificPlan -- Gets the requested plan from zoho subs
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} plan_code - The code of the plan you would like to retrieve
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/plans/${plan_code}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="plan"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [{plan}](https://www.zoho.com/subscriptions/api/v1/products/#retrieve-a-product)
     */
    getSpecificPlan: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, plan_code }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/plans/${plan_code}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `plan`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * getAllAddons -- Gets all of our root Addons from zoho subscriptions 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/addons"] - The url for the http request
     * @param {array<string>} [urlOptions=["filter_by.ALL"]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="addons"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [[{addons}]](https://www.zoho.com/subscriptions/api/v1/products/#list-all-addons)
     */
    getAllAddons: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/addons`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = ["filter_by.ALL"];
        if (!dataKey) dataKey = `addons`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult, transferConfigIDPath: `zohoSubscriptions/incrementalAddons` };
    },

    /**
     * getSpecificAddon -- Gets the requested plan from zoho subs 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {string} addon_code - The code of the addon you would like to retrieve
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/addons/${addon_code}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="addon"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [{addon}](https://www.zoho.com/subscriptions/api/v1/products/#retrieve-an-addon)
     */
    getSpecificAddon: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, addon_code }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/addons/${addon_code}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `addon`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
    },

    /**
     * getAllCoupons -- Gets all of our root Coupons from zoho subscriptions 
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/coupons"] - The url for the http request
     * @param {array<string>} [urlOptions=["filter_by.ALL"]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="coupons"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=false] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [[{coupons}]](https://www.zoho.com/subscriptions/api/v1/products/#list-all-coupons)
     */
    getAllCoupons: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/coupons`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = ["filter_by.ALL"];
        if (!dataKey) dataKey = `coupons`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = false;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult, transferConfigIDPath: `zohoSubscriptions/incrementalCoupons` };
    },

    /**
     * getSpecificCoupon -- Gets the requested coupon from zoho subs 
     * @param {string} coupon_code the code of the coupon you would like to retrieve
     * @param {string} oauth - an existing oauth token. If none is specified then one will be assigned
     * @param {boolean} [isTesting=false] - whether the environment should be LIVE or TESTING
     * @param {string} [url="https://www.zohoapis.com/billing/v1/coupons/${coupon_code}"] - The url for the http request
     * @param {array<string>} [urlOptions=[]] - Optional url parameters
     * @param {json} [customHeaders=null] - Optional custom headers to include
     * @param {string} [dataKey="coupon"] - The path to the desired data from http request response. Keys should be dot separated
     * @example <caption>Use dot separation to get nested keys values for return</caption>
     * To get top level data - dataKey:"myDesiredDataKey"
     * To get nested level data - dataKey:"rootKey.childKey.childKey.childKey"
     * @param {string} [method="GET"] - The desired http method -- defaults to endpoint specific method if none
     * @param {json} [body=null] - The raw json data for the body request. 
     * @param {boolean} [singlePull=true] - Whether we should use the zoho recursive pagination function or not.
     * @param {number} [rateLimit=1000] - A number of milliseconds to delay between each page request. - Must not be less than 1000 ms Required.
     * @param {number} [startingPage=1] - The page to start from.
     * @param {number} [pageCount=null] - The total number of pages to fetch. Leave null value to pull ALL
     * @returns the [{coupon}](https://www.zoho.com/subscriptions/api/v1/products/#retrieve-a-coupon)
     */
    getSpecificCoupon: async ({ oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount, coupon_code }) => {
        if (!url) url = `https://www.zohoapis.com/billing/v1/coupons/${coupon_code}`;
        if (!urlOptions || urlOptions.length === 0) urlOptions = [];
        if (!dataKey) dataKey = `coupon`;
        if (!method) method = 'GET';
        if (!singlePull) singlePull = true;

        let theResult = await genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount);
        return { theResult };
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
 * @param {Object} exportOptions All options necessary to export the data to the google cloud storage bucket
 * @example
 * exportOptions: { //optional, if not specified returns data directly
 *      bucketName: string, //name of gcs storage bucket
 *      fileName: string, //name of the file to export to in cloud storage, including file extension
 *      folderPath: string //path to export to in cloud storage
 *  }
*/
exports.zohoSubsLandingOnCall = functions.runWith(runtimeOpts540Sec8GB).https.onCall(async data => {
    if (!data || !data.dsk || data.dsk !== mySecretdsk) {
        return `Invalid Access Code. Access Denied`;
    }

    if (!data.worker || data.worker === ``) {
        return `No worker given. Aborting.`;
    }

    try {
        let { theResult, transferConfigIDPath } = await workers[data.worker](data.args);
        if (data.args.exportOptions && transferConfigIDPath) {
            let exportOptions = data.args.exportOptions;
            let response = await createOrOverwriteFileAndTriggerBQImport({
                transferConfigIDPath,
                bucketName: exportOptions.bucketName,
                fileObject: theResult.map(obj => JSON.stringify(obj).replace(/-0400/g, '').replace(/-0500/g, '').replace(/-0600/g, '').replace(/-0700/g, '')).join("\n"),
                fileName: exportOptions.fileName,
                folderPath: exportOptions.folderPath
            })
            return { ...response }
        } else {
            return shareable.deleteKeys(theResult, data.keysToDelete);
        }
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
* genericSubsMethod -- Generic push/put/delete/get method
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
async function genericSubsMethod(oauth, isTesting, url, urlOptions, customHeaders, dataKey, method, body, singlePull, rateLimit, startingPage, pageCount) {
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
//         const zohoAuthTokenAttempt = await zohoSubsOAuth.internalGetZohoToken({
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

//     var url = `https://www.zohoapis.com/billing/v1/invoices/${id}/email`;
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

// async function subsAddContactPersonToInvoice(sid, contactPersons, oauth) {
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

//     var url = `https://www.zohoapis.com/billing/v1/changeME`;


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
