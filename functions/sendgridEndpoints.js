// "use strict";
const admin = require("firebase-admin");
const functions = require("firebase-functions");

const runTimeVars = functions.config().envvars;
const mySecretdsk = runTimeVars.mySecret.dsk;

const sendgridMail = require('@sendgrid/mail')
sendgridMail.setApiKey(runTimeVars.sendgrid.apikey)

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
 *  The arguments should be passed as an array (defined here as "options"). The array must contain
 *  arguments for the specified worker in the correct order to be passed through to the endpoint. 
 */
let workers = {
    /**
     * Sends an email via the Sendgrid API. Either sends a regular email or a templated email based on the provided message data parameter
     * 
     * @param {JSON} msg The email data.
     * @example <caption>JSON body for non-templated email:</caption> 
     *      to: 'to@example.com', //Email address to send to,
     *      from: 'from@example.com', // Must be an authorized sender from the Sendgrid web UI
     *      subject: 'Email subject', //Subject of email,
     *      text: 'Plain text email', //Plain text version of email body ,
     *      html: '<p>Plain text <b>email</b></p>' //HTML version of email body,
     * @see https://docs.sendgrid.com/api-reference/mail-send/mail-send#:~:text=required-,Request%20Body,-Schema
     * @returns {Promise} A promise from the Sendgrid API.
     */
    sendEmail: async (msg) => {
        try {
            return await sendgridMail.send(msg)
        } catch (error) {
            if (error.response) {
                console.error(error.response.body)
            }
            return Promise.reject(error)
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
exports.sendGridLandingOnCall = functions.runWith(runtimeOpts30Sec2GB).https.onCall(async (data) => {
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
