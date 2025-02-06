// 'use strict';
const admin = require("firebase-admin");
const serviceAccount = require("./unifiedLibraryFirebaseKey.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://mySecret-unified-api-library-default-rtdb.firebaseio.com",
});
const functions = require("firebase-functions");
const db = admin.firestore();
const { Timestamp } = require('firebase-admin/firestore');

const runTimeVars = functions.config().envvars;
const mySecretdsk = runTimeVars.mySecret.dsk;

// Functions such as sleep, date calculations, etc, that can be shared among all scripts
const shareable = require('./shareableGlobalFunctions');

exports.zendeskEndpoints = require("./zendeskEndpoints");
exports.sendgridEndpoints = require("./sendgridEndpoints");
exports.zohoSubsEndpoints = require("./zohoSubscriptionsEndpoints");
exports.zohoBooksEndpoints = require("./zohoBooksEndpoints");
// exports.cloudStorageEndpoints = require("./cloudStorageEndpoints");
exports.paylianceACHEndpoints = require("./paylianceACHEndpoints");
exports.googleDriveEndpoints = require("./googleDriveEndpoints");
exports.googleSheetsEndpoints = require("./googleSheetsEndpoints");
exports.pubSubScheduledFunctions = require("./dynamicPubSubWorkerFile");

// Limit this usage to testing or one off HTTPS requests.
// exports.genericShareablePOSTEndpoints = require("./genericShareablePOSTEndpoints");
// exports.genericShareableGETEndpoints = require("./genericShareableGETEndpoints");

//Function can be triggered for testing. Will change most likely a lot. Not for production.
// exports.tes_t = functions.https.onCall(async data => {
//   async function processJobs(collectionName, statusToGet) {
//     // Consistent timestamp
//     const now = Timestamp.now()

//     // const now = admin.firestore.Timestamp.now();
//     // Query all documents ready to perform
//     const reff = admin.firestore().collection(collectionName);
//     const query = reff.where('performAt', '<=', now).where('status', '==', statusToGet);
//     const tasks = await query.get();
//     // Jobs to execute concurrently.
//     var jobs = [];

//     // Loop over tasks and push job.
//     tasks.forEach(snapshot => {
//       var snapID = snapshot.id;

//       var timeToAdd;
//       const { worker, options } = snapshot.data();
//       reff.doc(snapID).update({
//         status: 'working'
//       })

//       //Delete pubsub job so it doesn't run again.
//       const jobber = exports.workers[worker](options)
//         .then(() => snapshot.ref.delete())
//         .catch((err) => {
//           console.error(err);
//           snapshot.ref.update({ status: statusToGet });
//         });
//       jobs.push(jobber);
//     });
//     // Execute all jobs concurrently
//     await Promise.all(jobs);
//   }

//   // if (!data || !data.dsk || data.dsk !== mySecretdsk) {
//   //   return `Invalid Access Code. Access Denied`;
//   // }

//   // let scheduledJob = await this.pubSubScheduledFunctions.createScheduledJob(data.worker, data.performAt, data.runData, data.collectionName, data.statusToSet, data.docID)
//   // return scheduledJob;

//   return await this.pubSubScheduledFunctions.runIncrementals(`incrementalFunctions`, `scheduled`);
// })