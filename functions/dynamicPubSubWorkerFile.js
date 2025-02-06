/* use strict*/
/* eslint-disable no-await-in-loop*/
/* eslint-disable promise/no-nesting*/

const admin = require("firebase-admin");
const functions = require("firebase-functions");
const { URLSearchParams } = require('url'); //Necessary to encode certain calls as urlencoded json
const fetch = require('fetch-retry')(require('node-fetch'));
const shareable = require(`./shareableGlobalFunctions`);
const { triggerBQDataTransfer } = require('./shareableGlobalFunctions')
const runTimeVars = functions.config().envvars;
const db = admin.firestore();
const rdb = admin.database();
const { Timestamp } = require('firebase-admin/firestore');
const mySecretdsk = runTimeVars.mySecret.dsk;



// Business logic for named tasks. Function name should match worker field on task document. 
exports.workers = {

    /**
    * Execute the export
    * TODO: Perform initial export, create BigQuery table and implement data transfer
    */
    zendesk_incrementalTicketEvents: async (thePath) => {
        let startTime = await getStartTime(thePath);
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zendeskEndpoints-zendeskLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "incrementalTicketEvents",
                    "args": {
                        "startTime": startTime.toString(),
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zendeskIncrementalTicketEvents.json",
                            "folderPath": "zendesk/"
                        }
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            let response = await fetch(uri, fetchOptions);
            const { result } = await response.json()
            let newStartTime = result.end_time;
            return await updateStartTime(thePath, newStartTime);
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zendesk_incrementalTickets: async (thePath) => {
        let startTime = await getStartTime(thePath);
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zendeskEndpoints-zendeskLandingOnCall";
        // const uri = "FIREBASE CLOUD FUNCTIONS LOCAL EMULATOR ENDPOINT ADDRESS HEREus-central1/zendeskEndpoints-zendeskLandingOnCall"
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "incrementalTickets",
                    "args": {
                        "startTime": startTime.toString(),
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zendeskIncrementalTickets.json",
                            "folderPath": "zendesk/"
                        }
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            // console.log("startTime.toString():", startTime.toString());
            const response = await fetch(uri, fetchOptions);
            // console.log(`raw response: ${JSON.stringify(response)}`);
            const jsonResponse = await response.json();
            // console.log("Response received:", jsonResponse);
            const { result } = jsonResponse;

            let newStartTime = result && result.end_time ? result.end_time : Date.now(); // Use current epoch time if result.end_time is undefined
            // console.log("New start time:", newStartTime);

            // await triggerBQDataTransfer(await getTransferConfigId("zendesk/incrementalTickets"));
            return await updateStartTime(thePath, newStartTime);
        } catch (err) {
            console.error("Error during fetch or processing:", err);
            return err;
        }
    },

    /**
    * Execute the export
    */
    zendesk_incrementalUsers: async (thePath) => {
        let startTime = await getStartTime(thePath);
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zendeskEndpoints-zendeskLandingOnCall";
        // const uri = "FIREBASE CLOUD FUNCTIONS LOCAL EMULATOR ENDPOINT ADDRESS HEREus-central1/zendeskEndpoints-zendeskLandingOnCall"
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "incrementalUsers",
                    "args": {
                        "startTime": startTime.toString(),
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zendeskIncrementalUsers.json",
                            "folderPath": "zendesk/"
                        }
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            // console.log("startTime.toString():", startTime.toString());
            const response = await fetch(uri, fetchOptions);
            // console.log(`raw response: ${JSON.stringify(response)}`);
            const jsonResponse = await response.json();
            // console.log("Response received:", jsonResponse);
            const { result } = jsonResponse;

            let newStartTime = result && result.end_time ? result.end_time : Date.now(); // Use current epoch time if result.end_time is undefined
            // console.log("New start time:", newStartTime);

            // await triggerBQDataTransfer(await getTransferConfigId("zendesk/incrementalUsers"));
            return await updateStartTime(thePath, newStartTime);
        } catch (err) {
            console.error("Error during fetch or processing:", err);
            return err;
        }
    },

    /**
    * Execute the export
    */
    zendesk_incrementalOrganizations: async (thePath) => {
        let startTime = await getStartTime(thePath);
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zendeskEndpoints-zendeskLandingOnCall";
        // const uri = "FIREBASE CLOUD FUNCTIONS LOCAL EMULATOR ENDPOINT ADDRESS HEREus-central1/zendeskEndpoints-zendeskLandingOnCall"
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "incrementalOrganizations",
                    "args": {
                        "startTime": startTime.toString(),
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zendeskIncrementalOrganizations.json",
                            "folderPath": "zendesk/"
                        }
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            // console.log("startTime.toString():", startTime.toString());
            const response = await fetch(uri, fetchOptions);
            // console.log(`raw response: ${JSON.stringify(response)}`);
            const jsonResponse = await response.json();
            // console.log("Response received:", jsonResponse);
            const { result } = jsonResponse;

            let newStartTime = result && result.end_time ? result.end_time : Date.now(); // Use current epoch time if result.end_time is undefined
            // console.log("New start time:", newStartTime);

            // await triggerBQDataTransfer(await getTransferConfigId("zendesk/incrementalOrganizations"));
            return await updateStartTime(thePath, newStartTime);
        } catch (err) {
            console.error("Error during fetch or processing:", err);
            return err;
        }
    },

    /**
     * Execute the export
     */
    zohoBooks_getDealersByName: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoBooksEndpoints-zohoBooksLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getDealersByName",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoBooksAllCustomers.json",
                            "folderPath": "zoho/books/"
                        },
                        "oauth": null,
                        "contact_name": "",
                        "isTesting": null,
                        "url": null,
                        "dataKey": null,
                        "method": null,
                        "body": null,
                        "singlePull": false,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            const result = await fetch(uri, fetchOptions);
            // triggerBQDataTransfer(await getTransferConfigId("zohoBooks/incrementalOrgs"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zohoSubscriptions_getAllAddons: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoSubsEndpoints-zohoSubsLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getAllAddons",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoSubscriptionsAllAddons.json",
                            "folderPath": "zoho/subscriptions/"
                        },
                        "oauth": null,
                        "isTesting": null,
                        "url": null,
                        "dataKey": null,
                        "method": null,
                        "body": null,
                        "singlePull": false,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            const result = await fetch(uri, fetchOptions);
            triggerBQDataTransfer(await getTransferConfigId("zohoSubscriptions/incrementalAddons"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zohoSubscriptions_getAllCoupons: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoSubsEndpoints-zohoSubsLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getAllCoupons",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoSubscriptionsAllCoupons.json",
                            "folderPath": "zoho/subscriptions/"
                        },
                        "oauth": null,
                        "isTesting": null,
                        "url": null,
                        "dataKey": null,
                        "method": null,
                        "body": null,
                        "singlePull": false,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            const result = await fetch(uri, fetchOptions);
            triggerBQDataTransfer(await getTransferConfigId("zohoSubscriptions/incrementalCoupons"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zohoSubscriptions_getAllCustomers: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoSubsEndpoints-zohoSubsLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getAllCustomers",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoSubscriptionsAllCustomers.json",
                            "folderPath": "zoho/subscriptions/"
                        },
                        "oauth": null,
                        "isTesting": null,
                        "url": null,
                        "urlOptions": ["filter_by=Status.All"],
                        "dataKey": null,
                        "method": null,
                        "body": null,
                        "singlePull": false,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            console.log(fetchOptions.body)
            console.log(`sending to zohoSubsLanding-getAllCustomers`)
            const result = await fetch(uri, fetchOptions);
            console.log(`back from that`)
            triggerBQDataTransfer(await getTransferConfigId("zohoSubscriptions/incrementalCustomers"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zohoSubscriptions_getAllInvoices: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoSubsEndpoints-zohoSubsLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getAllInvoices",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoSubscriptionsAllInvoices.json",
                            "folderPath": "zoho/subscriptions/"
                        },
                        "oauth": null,
                        "isTesting": null,
                        "url": null,
                        "dataKey": null,
                        "method": null,
                        "body": null,
                        "singlePull": false,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null,
                        "invoiceViewID": ""
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            const result = await fetch(uri, fetchOptions);
            triggerBQDataTransfer(await getTransferConfigId("zohoSubscriptions/incrementalInvoices"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zohoSubscriptions_getAllPlans: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoSubsEndpoints-zohoSubsLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getAllPlans",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoSubscriptionsAllPlans.json",
                            "folderPath": "zoho/subscriptions/"
                        },
                        "oauth": null,
                        "isTesting": null,
                        "url": null,
                        "dataKey": null,
                        "method": null,
                        "body": null,
                        "singlePull": false,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            const result = await fetch(uri, fetchOptions);
            triggerBQDataTransfer(await getTransferConfigId("zohoSubscriptions/incrementalPlans"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zohoSubscriptions_getAllProducts: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoSubsEndpoints-zohoSubsLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getAllProducts",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoSubscriptionsAllProducts.json",
                            "folderPath": "zoho/subscriptions/"
                        },
                        "oauth": null,
                        "isTesting": null,
                        "url": null,
                        "dataKey": null,
                        "method": null,
                        "body": null,
                        "singlePull": false,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            const result = await fetch(uri, fetchOptions);
            triggerBQDataTransfer(await getTransferConfigId("zohoSubscriptions/incrementalProducts"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zohoSubscriptions_getAllSubscriptions: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoSubsEndpoints-zohoSubsLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getAllSubscriptions",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoSubscriptionsAllSubscriptions.json",
                            "folderPath": "zoho/subscriptions/"
                        },
                        "oauth": null,
                        "isTesting": null,
                        "url": null,
                        "dataKey": null,
                        "method": null,
                        "body": null,
                        "singlePull": false,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            const result = await fetch(uri, fetchOptions);
            triggerBQDataTransfer(await getTransferConfigId("zohoSubscriptions/incrementalSubscriptions"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },

    /**
    * Execute the export
    */
    zohoSubscriptions_getReasonsForCancellation: async () => {
        const uri = "FIREBASE CLOUD FUNCTIONS ENDPOINT ADDRESS HERE/zohoSubsEndpoints-zohoSubsLandingOnCall";
        const headers = { "Content-Type": "application/json" };

        let fetchOptions = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                data: {
                    "worker": "getReasonsForCancellation",
                    "keysToDelete": [],
                    "args": {
                        "exportOptions": {
                            "bucketName": "unified_database_etl",
                            "fileName": "zohoSubscriptionsReasonsForCancellation.json",
                            "folderPath": "zoho/subscriptions/"
                        },
                        "oauth": null,
                        "isTesting": null,
                        "url": null,
                        "dataKey": "churn_messages_settings.churn_messages",
                        "method": null,
                        "body": null,
                        "singlePull": true,
                        "rateLimit": null,
                        "startingPage": null,
                        "pageCount": null
                    },
                    "dsk": mySecretdsk
                }
            }),
            redirect: 'follow'
        }

        try {
            const result = await fetch(uri, fetchOptions);
            triggerBQDataTransfer(await getTransferConfigId("zohoSubscriptions/incrementalReasonsForCancellation"))
            return result;
        }
        catch (err) {
            console.error(err)
            return err;
        }
    },
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

// exports.runIncrementalExportsWorkers = functions.runWith(runtimeOpts540Sec8GB).pubsub.schedule('* * * * *').timeZone('America/New_York').onRun(async (context) => {
//     var promises = [];
//     promises.push(exports.runIncrementals(`incrementalFunctions`, `scheduled`));

//     var results = await Promise.all(promises);
//     return results;
// })

exports.runIncrementalExportsWorkers = functions.runWith(runtimeOpts540Sec8GB).pubsub.schedule('* * * * *').timeZone('America/New_York').onRun(async (context) => {
    var promises = [];
    promises.push(exports.runIncrementals(`incrementalFunctions`, `scheduled`));

    var results = await Promise.all(promises);

    return results;
});

exports.createScheduledJob = async function (worker, performAt, runData, collectionName, statusToSet, docID) {
    function dateIsValid(date) {
        return date instanceof Date && !isNaN(date);
    }

    if (performAt && isNaN(performAt) === false && (performAt instanceof Timestamp === true || dateIsValid(performAt) === true)) {
        //Is a date. No need to transform.
    } else {
        //Is NOT a date. We will now assume this is MINUTES and convert that to a date object of now + minutes for schedule.
        let newPerformAt = new Date(Date.now() + (performAt * 60000)); // add delay in ms to current UNIX time for UTC 0
        performAt = null;
        performAt = newPerformAt;
    }

    collectionName = collectionName ? collectionName : 'incrementalFunctions';
    statusToSet = statusToSet ? statusToSet : 'scheduled';

    let taskRef;
    if (!docID) {
        taskRef = await db.collection(collectionName).add({
            worker: worker,
            performAt: performAt,
            options: {
                runData: runData
            },
            status: statusToSet
        }).catch(err => {
            return err;
        });
    } else {
        taskRef = await db.collection(collectionName).doc(docID).set({
            worker: worker,
            performAt: performAt,
            options: {
                runData: runData
            },
            status: statusToSet
        }).catch(err => {
            return err;
        });
    }

    return taskRef;
}

exports.runIncrementals = async function (collectionName, statusToGet) {
    async function getNewTime(schedulePath, performAt) {
        let snapshot = await rdb.ref(`/incrementalSchedules/${schedulePath}/`).once('value');
        let dbVal = snapshot.val();
        let newIncrementalTime;
        if (dbVal) {
            newIncrementalTime = new Date(performAt.toMillis() + (dbVal.cycleMinutes * 60000));
        } else {
            newIncrementalTime = new Date(performAt.toMillis() + (1440 * 60000));
            await rdb.ref(`/incrementalSchedules/${schedulePath}`).update({ cycleMinutes: 1440 });
        }
        return newIncrementalTime;
    }

    const now = Timestamp.now();
    const reff = admin.firestore().collection(collectionName);
    const query = reff.where('performAt', '<=', now).where('status', '==', statusToGet);
    const tasks = await query.get();

    var jobs = [];
    let zendeskWorkerRunning = false;

    tasks.forEach(async snapshot => {
        const { worker, performAt } = snapshot.data();

        if (worker.startsWith('zendesk_')) {
            if (zendeskWorkerRunning) {
                snapshot.ref.update({
                    status: 'hold4conflict'
                });
                return;
            } else {
                // Mark that a Zendesk worker is running
                zendeskWorkerRunning = true;
            }
        }

        var snapID = snapshot.id;
        let thePath = worker.replace('_', '/');
        let newIncrementalTime = await getNewTime(thePath, performAt);

        reff.doc(snapID).update({
            status: 'working',
            performAt: newIncrementalTime
        });

        const jobber = exports.workers[worker](thePath)
            .then(async () => {
                reff.doc(snapID).update({
                    status: 'scheduled'
                });
            })
            .catch((err) => {
                console.error(err);
                snapshot.ref.update({
                    status: statusToGet,
                    performAt: new Date(Date.now() + (60 * 60000))
                });
            });
        jobs.push(jobber);
    });

    // Execute all jobs concurrently
    await Promise.all(jobs);

    // Return held tasks to be processed later
    return;
};

// exports.runIncrementals = async function (collectionName, statusToGet) {
//     async function getNewTime(schedulePath, performAt) {
//         let snapshot = await rdb.ref(`/incrementalSchedules/${schedulePath}/`).once('value');
//         let dbVal = snapshot.val();
//         let newIncrementalTime;
//         if (dbVal) {
//             newIncrementalTime = new Date(performAt.toMillis() + (dbVal.cycleMinutes * 60000));
//         } else {
//             newIncrementalTime = new Date(performAt.toMillis() + (1440 * 60000));
//             await rdb.ref(`/incrementalSchedules/${schedulePath}`).update({ cycleMinutes: 1440 });
//         }
//         return newIncrementalTime;
//     }

//     const now = Timestamp.now();
//     const reff = admin.firestore().collection(collectionName);
//     const query = reff.where('performAt', '<=', now).where('status', '==', statusToGet);
//     const tasks = await query.get();

//     var jobs = [];
//     let zendeskWorkerRunning = false;

//     tasks.forEach(async snapshot => {
//         const { worker, performAt } = snapshot.data();

//         if (worker.startsWith('zendesk_')) {
//             if (zendeskWorkerRunning) {
//                 // Skip this worker and leave as scheduled
//                 return;
//             } else {
//                 // Mark that a Zendesk worker is running
//                 zendeskWorkerRunning = true;
//             }
//         }

//         var snapID = snapshot.id;
//         let thePath = worker.replace('_', '/');
//         let newIncrementalTime = await getNewTime(thePath, performAt);

//         reff.doc(snapID).update({
//             status: 'working',
//             performAt: newIncrementalTime
//         });

//         const jobber = exports.workers[worker](thePath)
//             .then(async () => {
//                 reff.doc(snapID).update({
//                     status: 'scheduled'
//                 });
//             })
//             .catch((err) => {
//                 console.error(err);
//                 snapshot.ref.update({
//                     status: statusToGet,
//                     performAt: new Date(Date.now() + (60 * 60000))
//                 });
//             });
//         jobs.push(jobber);
//     });

//     await Promise.all(jobs);
// };

async function getStartTime(schedulePath) {//useful for zendesk incremental exports since they provide it.
    let snapshot = await rdb.ref(`/incrementalSchedules/${schedulePath}/`).once('value')
    let dbVal = snapshot.val();
    let startTime = dbVal.startTime ? dbVal.startTime : Timestamp.now().toMillis();
    return startTime;
}

async function updateStartTime(schedulePath, newStartTime) {
    if (!newStartTime) {
        newStartTime = Date.now(); // Set to current epoch time if undefined
    }
    await rdb.ref(`/incrementalSchedules/${schedulePath}`).update({ startTime: newStartTime.toString() });
}

async function getTransferConfigId(transferPath) {
    let snapshot = await rdb.ref(`/dataTransferConfigIds/${transferPath}/`).once('value')
    let dbVal = snapshot.val();
    return dbVal;
}