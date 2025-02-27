// // "use strict";
// const admin = require("firebase-admin");
// const functions = require("firebase-functions");

// const runTimeVars = functions.config().envvars;
// const mySecretdsk = runTimeVars.mySecret.dsk;

// //#region Cloud Functions Runtime Options
// /**
//  * Provides 8GB of memory with a 540 second timeout.
//  * Should be reserved to those functions that take an extremely long time.
//  */
// const runtimeOpts540Sec8GB = {
//     timeoutSeconds: 540,
//     memory: "8GB",
// };

// /**
//  * Provides 2GB of memory with a 30 second timeout.
//  * Enough memory to not fail, but a short timeout life
//  */
// const runtimeOpts30Sec2GB = {
//     timeoutSeconds: 30,
//     memory: "2GB",
// };

// // If you need something inbetween these options
// // Feel free to create a runtimeOption that suits your need

// //#endregion

// //#region Worker Functions

// /**
//  *  Workers are named tasks that can be invoked when calling the firebase function.
//  *  The worker name determines what function(s) will execute on the provided arguments.
//  *  The arguments should be passed as an array (defined here as "options"). The array must contain
//  *  arguments for the specified worker in the correct order to be passed through to the Zendesk API.
//  *  The last option in the array is always an optional callback function
//  */
// let workers = {
//     /**
//      * Generic function -- Change Me
//      *
//      * @param {Array} options array of parameters to pass through to the Zendesk API request: [ticketID, (optional) callbackFunction].
//      * @returns If no callback function was included, returns a promise. Otherwise returns based on the callback function.
//      */
//     changeMe: async (options) => {
//         return await changeME(...options)
//     },
// };

// //#endregion

// //#region Callable Cloud Functions

// /**
//  * SAMPLE POST REQUEST BODY
//  * {
//  *     "data": {
//  *         "worker": "yourDesiredWorkerNameHere",
//  *         "args":[`array`,`values of`,`any args you want to use`,`can be string, or number, or another array (aoa), or anything else you need to pass in`],
//  *         "dsk": "Dealer Special Key Here"
//  *     }
//  * }
//  */

// /**
//  * Runs the cloud function using the specified runtime options and the data provided via HTTP
//  */
// exports.changeME = functions.runWith(runtimeOpts30Sec2GB).https.onCall(async (data) => {
//     if (!data || !data.dsk || data.dsk !== mySecretdsk) {
//         return `Invalid Access Code. Access Denied`;
//     }

//     if (!data.worker || data.worker === ``) {
//         return `No worker given. Aborting.`;
//     }

//     /** This check was originally in place to prevent no arguments, but some list endpoints do not require any arguments (i.e. they only have optional arguments) */
//     // if (!data.args || data.args.length === 0) {
//     //     return `Must specify at least one argument in array format`;
//     // }

//     try {
//         return await workers[data.worker](data.args);
//     }
//     catch (err) {
//         return err;
//     }
// });

// //#endregion

// //#region Supporting Functions

// //Any supporting functions you may need should go here. Don't clutter the workers var with unneccessary functions.

// //#endregion
