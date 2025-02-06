// "use strict";
const admin = require("firebase-admin");
const functions = require("firebase-functions");

const runTimeVars = functions.config().envvars;
const mySecretdsk = runTimeVars.mySecret.dsk;

const { sleep, deleteKeys } = require("./shareableGlobalFunctions");
const { createOrOverwriteFileAndTriggerBQImport } = require("./shareableGlobalFunctions");
const fetch = require('fetch-retry')(require('node-fetch'));

/**
 * Node wrapper for Zendesk API
 * @see https://blakmatrix.github.io/node-zendesk/
 */
const zendesk = require('node-zendesk');
const { application } = require("express");
const { ResultStorage } = require("firebase-functions/v1/testLab");
const zen_auth = 'Basic ' + Buffer.from(runTimeVars.zendesk.username + '/token:' + runTimeVars.zendesk.token).toString('base64')

/** Client for Default Zendesk API wrapper 
 * @see https://blakmatrix.github.io/node-zendesk/api/#core-api-methods
 */
const zen_default_client = zendesk.createClient({
    username: runTimeVars.zendesk.username,
    token: runTimeVars.zendesk.token,
    remoteUri: runTimeVars.zendesk.remoteuri,
    disableGlobalState: true,
});

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
 * 
 * TODO:  
 *  - listRecordings() and getRecording() (use url fetch to the recording url via comment+call id)
 * 
 *  - Extra: sandbox client and update sandbox uri endpoint
 *  - Extra: improve pagination by querying count and then running more asynchronously
 */
let workers = {

    /**
     * Searches Zendesk talk for available phone numbers matching the search parameters
     * 
     * @param {string} searchTerm A [search query](https://developer.zendesk.com/api-reference/voice/talk-api/phone_numbers/#json-format-of-available-phone-numbers) for available phone numbers.
     * @returns An array of available phone numbers matching the query.
     */
    availablePhoneNumbers: async ({ searchTerm }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/channels/voice/phone_numbers/search?${searchTerm}`
        return await zenHttpRequest("GET", uri)
    },


    /**
     * Creates a new support email.
     * 
     * @param {string} name The label for the email address
     * @param {string} localPart The [local part](https://en.wikipedia.org/wiki/Email_address#Local-part) of the email address
     * @returns The newly created address
     */
    createAddress: async ({ name, localPart }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/recipient_addresses.json`
        return await zenHttpRequest("POST", uri, { recipient_address: { name: name, email: `${localPart}@residential.zendesk.com` } })
    },


    /**
     * Creates an identity for a user
     * 
     * @param {string} userID The user ID to to create the identity for
     * @param {Object} identity A single JSON object representing an [identity](https://developer.zendesk.com/api-reference/ticketing/users/user_identities/#json-format)
     * @returns A promise.
     */
    createIdentity: async ({ userID, identity }) => {
        return await zen_default_client.useridentities.create(userID, { identity })
    },


    /**
     * Creates a new ticket in Zendesk.
     * 
     * @param {Object} ticket A single JSON object representing a [Zendesk ticket](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#json-format)
     * @returns A promise.
     */
    createTicket: async (ticket) => {
        return await zen_default_client.tickets.create(ticket)
    },


    /**
     * Creates one or more new tickets in Zendesk.
     * 
     * @param {Array} tickets An array of up to 100 [ticket JSON objects](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#json-format)
     * @returns A [job status](https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/#json-format)
     */
    createTickets: async (tickets) => {
        return await zen_default_client.tickets.createMany(tickets)
    },


    /**
     * Creates a new user in Zendesk.
     * 
     * @param {Object} user A single JSON object representing a [Zendesk user](https://developer.zendesk.com/api-reference/ticketing/users/users/#json-format)
     * @returns A promise.
     */
    createUser: async (user) => {
        return await zen_default_client.users.create(user)
    },


    /**
     * Creates one or more new users in Zendesk.
     * 
     * @param {Array} users An array of up to 100 [user JSON objects](https://developer.zendesk.com/api-reference/ticketing/users/users/#json-format)
     * @returns A [job status](https://developer.zendesk.com/api-reference/usering/user-management/job_statuses/#json-format)
     */
    createUsers: async (users) => {
        return await zen_default_client.users.createMany(users)
    },


    /**
     * Creates a new organization in Zendesk.
     * 
     * @param {Object} organization A single JSON object representing a [Zendesk organization](https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#json-format)
     * @returns A promise.
     */
    createOrganization: async (organization) => {
        return await zen_default_client.organizations.create(organization)
    },


    /**
     * Creates one or more new organizations in Zendesk.
     * 
     * @param {Array} organizations An array of up to 100 [organization JSON objects](https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#json-format)
     * @returns A [job status](https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/#json-format)
     */
    createOrganizations: async (organizations) => {
        return await zen_default_client.organizations.createMany(organizations)
    },


    /**
     * Creates a Talk phone number from an available phone number. 
     * The available phone number is specified by a token returned by a search for available numbers.
     * 
     * @param {string} phoneToken A token representing an available phone number. See [Search for Available Phone Numbers](https://developer.zendesk.com/api-reference/voice/talk-api/phone_numbers/#search-for-available-phone-numbers).
     * 
     * TODO: Add ways to set other phone settings
     * 
     * @returns The newly created phone number.
     */
    createPhoneNumber: async ({ name, phoneToken }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/channels/voice/phone_numbers`
        return await zenHttpRequest("POST", uri, { nickname: name, phone_number: { token: phoneToken } })
    },


    /**
     * Deletes a Zendesk support email address.
     * 
     * @param {string} ticketID A single email address ID.
     * @returns Status 204 No Content if successful
     */
    deleteAddress: async ({ addressID }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/recipient_addresses/${addressID}.json`
        return await zenHttpRequest("DELETE", uri)
    },


    /**
     * Deletes an identity for a user
     * 
     * @param {string} userID The user ID to to delete the identity for
     * @param {string} identityID The identity ID to to delete
     * @returns A promise.
     */
    deleteIdentity: async ({ userID, identityID }) => {
        return await zen_default_client.useridentities.delete(userID, identityID)
    },


    /**
     * Deletes a single Zendesk ticket.
     * 
     * @param {string} ticketID A single ticket ID.
     * @returns A promise.
     */
    deleteTicket: async ({ ticketID }) => {
        return await zen_default_client.tickets.delete(ticketID)
    },


    /**
     * Deletes one or more Zendesk tickets.
     *
     * @param {Array} ticketIDs An array of up to 100 ticket ID strings.
     * @returns A [job status](https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/#json-format).
     */
    deleteTickets: async ({ ticketIDs }) => {
        return await zen_default_client.tickets.deleteMany(ticketIDs)
    },


    /**
     * Deletes a single Zendesk user.
     * 
     * @param {string} userID A single user ID.
     * @returns A promise.
     */
    deleteUser: async ({ userID }) => {
        return await zen_default_client.users.delete(userID)
    },


    /**
     * Deletes one or more Zendesk users.
     *
     * @param {Array} userIDs An array of up to 100 user ID strings.
     * @returns A [job status](https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/#json-format).
     */
    deleteUsers: async ({ userIDs }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/users/destroy_many.json?ids=${userIDs.join(",")}`
        return await zenHttpRequest("DELETE", uri)
    },


    /**
     * Deletes a single Zendesk organization.
     * 
     * @param {string} organizationID A single organization ID.
     * @returns A promise.
     */
    deleteOrganization: async ({ organizationID }) => {
        return await zen_default_client.organizations.delete(organizationID)
    },


    /**
     * Deletes one or more Zendesk organizations.
     *
     * @param {Array} organizationIDs An array of up to 100 organization ID strings.
     * @returns A [job status](https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/#json-format).
     */
    deleteOrganizations: async ({ organizationIDs }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/organizations/destroy_many.json?ids=${organizationIDs.join(",")}`
        return await zenHttpRequest("DELETE", uri)
    },


    /**
     * Deletes a Zendesk phone number
     * 
     * @param {string} phoneNumberID A Zendesk talk phone number ID.
     * @returns An HTTP status code. 200 OK if deleted successfully.
     */
    deletePhoneNumber: async ({ phoneNumberID }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/channels/voice/phone_numbers/${phoneNumberID}.json`
        return await zenHttpRequest("DELETE", uri)
    },


    /**
     * Returns the comments for a given ticket ID. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} ticketID The ticket ID to get comments for.
     * @returns A promise.
     */
    getComments: async ({ ticketID }) => {
        return await zen_default_client.tickets.getComments(ticketID)
    },

    /**
     * TODO
     */
    // getRecording: async () => {
    // },

    /**
     * Returns an incremental export of tickets from a given starting UNIX epoch time. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} startTime A UNIX epoch timestamp to start the export from.
     * @param {number} rateLimit (Optional) A number of milliseconds to wait beteween each page request. Must be >= 1000ms, and defaults to 1000ms.
     * @param {Object} exportOptions All options necessary to export the data to the google cloud storage bucket
     * @example
     * exportOptions: { //optional, if not specified returns data directly
     *      bucketName: string, //name of gcs storage bucket
     *      fileName: string, //name of the file to export to in cloud storage, including file extension
     *      folderPath: string //path to export to in cloud storage
     *  }
     * @returns A promise.
     */
    incrementalOrganizations: async ({ startTime, rateLimit = 6000, exportOptions }) => {
        try {
            rateLimit < 6000 ? rateLimit = 6000 : rateLimit;
            let result = await zenTimePagination(`${runTimeVars.zendesk.remoteuri}/incremental/organizations`, startTime, "organizations", rateLimit);

            if (exportOptions && result.organizations && result.organizations.length > 0) {
                try {
                    let response = await createOrOverwriteFileAndTriggerBQImport({
                        transferConfigIDPath: "zendesk/incrementalOrganizations",
                        bucketName: exportOptions.bucketName,
                        fileObject: result.organizations.map(obj => JSON.stringify(obj)).join("\n"),
                        fileName: exportOptions.fileName,
                        folderPath: exportOptions.folderPath,
                        customTime: new Date(result.end_time * 1000).toISOString() //*1000 to convert to ms, toISOString() since GCS requires RFC 3339 format
                    });
                    // Process held tasks
                    await exports.processHeldTasks(`incrementalFunctions`);
                    return { ...response, end_time: result.end_time };
                } catch (error) {
                    // Process held tasks
                    await exports.processHeldTasks(`incrementalFunctions`);
                    console.error(`Error in createOrOverwriteFileAndTriggerBQImport: ${error.message}`);
                    return { error: `Error in createOrOverwriteFileAndTriggerBQImport: ${error.message}`, end_time: result.end_time };
                }
            } else {
                // Process held tasks
                await exports.processHeldTasks(`incrementalFunctions`);
                if (!result.organizations || result.organizations.length === 0) {
                    console.log("No organizations data to write.");
                }
                return result;
            }
        } catch (error) {
            console.error(`Error in incrementalOrganizations: ${error.message}`);
            return { error: `Error in incrementalOrganizations: ${error.message}` };
        }
    },

    /**
     * Returns an incremental export of users from a given starting UNIX epoch time. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} startTime A UNIX epoch timestamp to start the export from.
     * @param {number} rateLimit (Optional) A number of milliseconds to wait between each page request. Must be >= 1000ms, and defaults to 1000ms.
     * @param {Object} exportOptions All options necessary to export the data to the google cloud storage bucket
     * @example
     * exportOptions: { //optional, if not specified returns data directly
     *      bucketName: string, //name of gcs storage bucket
     *      fileName: string, //name of the file to export to in cloud storage, including file extension
     *      folderPath: string //path to export to in cloud storage
     *  }
     * @returns A promise.
     */
    incrementalUsers: async ({ startTime, rateLimit = 6000, exportOptions }) => {
        try {
            rateLimit < 6000 ? rateLimit = 6000 : rateLimit;
            let result = await zenTimePagination(`${runTimeVars.zendesk.remoteuri}/incremental/users`, startTime, "users", rateLimit);

            if (exportOptions && result.users && result.users.length > 0) {
                try {
                    let response = await createOrOverwriteFileAndTriggerBQImport({
                        transferConfigIDPath: "zendesk/incrementalUsers",
                        bucketName: exportOptions.bucketName,
                        fileObject: result.users.map(obj => JSON.stringify(obj)).join("\n"),
                        fileName: exportOptions.fileName,
                        folderPath: exportOptions.folderPath,
                        customTime: new Date(result.end_time * 1000).toISOString() //*1000 to convert to ms, toISOString() since GCS requires RFC 3339 format
                    });
                    // Process held tasks
                    await exports.processHeldTasks(`incrementalFunctions`);
                    return { ...response, end_time: result.end_time };
                } catch (error) {
                    // Process held tasks
                    await exports.processHeldTasks(`incrementalFunctions`);
                    console.error(`Error in createOrOverwriteFileAndTriggerBQImport: ${error.message}`);
                    return { error: `Error in createOrOverwriteFileAndTriggerBQImport: ${error.message}`, end_time: result.end_time };
                }
            } else {
                // Process held tasks
                await exports.processHeldTasks(`incrementalFunctions`);
                if (!result.users || result.users.length === 0) {
                    console.log("No users data to write.");
                }
                return result;
            }
        } catch (error) {
            console.error(`Error in incrementalUsers: ${error.message}`);
            return { error: `Error in incrementalUsers: ${error.message}` };
        }
    },
    /**
     * Returns an incremental export of tickets from a given starting UNIX epoch time. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} startTime A UNIX epoch timestamp to start the export from.
     * @param {number} rateLimit (Optional) A number of milliseconds to wait between each page request. Must be >= 1000ms, and defaults to 1000ms.
     * @param {Object} exportOptions All options necessary to export the data to the google cloud storage bucket
     * @example
     * exportOptions: { //optional, if not specified returns data directly
     *      bucketName: string, //name of gcs storage bucket
     *      fileName: string, //name of the file to export to in cloud storage, including file extension
     *      folderPath: string //path to export to in cloud storage
     *  }
     * @returns A promise.
     */
    incrementalTickets: async ({ startTime, rateLimit = 6000, exportOptions }) => {
        try {
            rateLimit < 6000 ? rateLimit = 6000 : rateLimit;
            let result = await zenTimePagination(`${runTimeVars.zendesk.remoteuri}/incremental/tickets`, startTime, "tickets", rateLimit);

            if (exportOptions && result.tickets && result.tickets.length > 0) {
                try {
                    // Define the separator for joining array elements
                    const separator = '|@|';

                    // Function to convert value to a string if it's an array
                    const convertValueToString = (fields) => {
                        fields.forEach(field => {
                            if (Array.isArray(field.value)) {
                                field.value = field.value.join(separator);
                            } else if (field.value === null) {
                                field.value = '';
                            }
                        });
                    };

                    // Iterate through the tickets
                    result.tickets.forEach(ticket => {
                        // Nullify satisfaction_rating if it exists
                        if (ticket.satisfaction_rating !== undefined) {
                            ticket.satisfaction_rating = null;
                        }

                        // Convert custom_fields.value and fields.value to a string if it's an array
                        if (ticket.custom_fields) {
                            convertValueToString(ticket.custom_fields);
                        }
                        if (ticket.fields) {
                            convertValueToString(ticket.fields);
                        }
                    });

                    // Create the file content by stringifying each ticket object and joining them with newline characters
                    const fileContent = result.tickets.map(obj => JSON.stringify(obj)).join("\n");

                    let response = await createOrOverwriteFileAndTriggerBQImport({
                        transferConfigIDPath: "zendesk/incrementalTickets",
                        bucketName: exportOptions.bucketName,
                        fileObject: fileContent,
                        fileName: exportOptions.fileName,
                        folderPath: exportOptions.folderPath,
                        customTime: new Date(result.end_time * 1000).toISOString() //*1000 to convert to ms, toISOString() since GCS requires RFC 3339 format
                    });

                    // Process held tasks
                    await exports.processHeldTasks(`incrementalFunctions`);
                    return { ...response, end_time: result.end_time };
                } catch (error) {
                    // Process held tasks
                    await exports.processHeldTasks(`incrementalFunctions`);
                    console.error(`Error in createOrOverwriteFileAndTriggerBQImport: ${error.message}`);
                    return { error: `Error in createOrOverwriteFileAndTriggerBQImport: ${error.message}`, end_time: result.end_time };
                }
            } else {
                // Process held tasks
                await exports.processHeldTasks(`incrementalFunctions`);
                if (!result.tickets || result.tickets.length === 0) {
                    console.log("No tickets data to write.");
                }
                return result;
            }
        } catch (error) {
            console.error(`Error in incrementalTickets: ${error.message}`);
            return { error: `Error in incrementalTickets: ${error.message}` };
        }
    },

    /**
     * Returns an incremental export of all ticket events from a given starting UNIX epoch time. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} startTime A UNIX epoch timestamp to start the export from.
     * @param {number} rateLimit (Optional) A number of milliseconds to wait beteween each page request. Must be >= 1000ms, and defaults to 1000ms.
     * @param {Object} exportOptions All options necessary to export the data to the google cloud storage bucket
     * @example
     * exportOptions: { //optional, if not specified returns data directly
     *      bucketName: string, //name of gcs storage bucket
     *      fileName: string, //name of the file to export to in cloud storage, including file extension
     *      folderPath: string //path to export to in cloud storage
     *  }
     * @returns A promise.
     */
    incrementalTicketEvents: async ({ startTime, rateLimit = 6000, exportOptions }) => {
        try {
            rateLimit < 6000 ? rateLimit = 6000 : rateLimit
            let result = await zenTimePagination(`${runTimeVars.zendesk.remoteuri}/incremental/ticket_events`, startTime, "ticket_events", rateLimit)

            if (exportOptions) {
                try {
                    let response = await createOrOverwriteFileAndTriggerBQImport({
                        transferConfigIDPath: "zendesk/incrementalTicketEvents",
                        bucketName: exportOptions.bucketName,
                        fileObject: result.tickets.map(obj => JSON.stringify(obj)).join("\n"),
                        fileName: exportOptions.fileName,
                        folderPath: exportOptions.folderPath,
                        customTime: new Date(result.end_time * 1000).toISOString() //*1000 to convert to ms, toISOString() since GCS requires RFC 3339 format
                    });
                    // Process held tasks
                    await exports.processHeldTasks(`incrementalFunctions`);
                    return { ...response, end_time: result.end_time };
                } catch (error) {
                    // Process held tasks
                    await exports.processHeldTasks(`incrementalFunctions`);
                    console.error(`Error in createOrOverwriteFileAndTriggerBQImport: ${error.message}`);
                    return { error: `Error in createOrOverwriteFileAndTriggerBQImport: ${error.message}`, end_time: result.end_time };
                }
            } else {
                // Process held tasks
                await exports.processHeldTasks(`incrementalFunctions`);
                return result;
            }
        } catch (error) {
            console.error(`Error in incrementalTickets: ${error.message}`);
            return { error: `Error in incrementalTickets: ${error.message}` };
        }
    },


    /**
     * Lists all support email addresses on the account.
     * 
     * @param {number} startingPage The page to start returning numbers from. 100 values per page.
     * @param {number} pageCount The number of pages to get.
     * @param {number} rateLimit (Optional) A number of milliseconds to wait beteween each page request. Must be >= 1000ms, and defaults to 1000ms.
     * 
     * @returns A list of all the support address for the account.
     */
    listAddresses: async ({ startingPage, pageCount, rateLimit = 6000 }) => {
        rateLimit < 6000 ? rateLimit = 6000 : rateLimit
        let uri = `${runTimeVars.zendesk.remoteuri}/recipient_addresses.json`
        let fetchOptions =
        {
            method: 'GET',
            headers: { 'Authorization': zen_auth },
        }
        return await zenOffsetPagination(uri, [], fetchOptions, "recipient_addresses", rateLimit, startingPage, pageCount)
    },


    /**
     * Returns a list of ticket audits (events) for a given ticket ID. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} ticketID The ticket ID to list audits for.
     * 
     * @returns A promise.
     */
    listAudits: async ({ ticketID }) => {
        return await zen_default_client.ticketaudits.list(ticketID)

    },


    /**
     * Returns the identities of a user (emails, phone numbers, social media accounts, etc) for a given user ID. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} userID The user ID to list identities for.
     * 
     * @returns A promise.
     */
    listIdentities: async ({ userID }) => {
        return await zen_default_client.useridentities.list(userID)

    },


    /**
     * Returns a list of organization memberships for a given user. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} userID The user ID to list organization memberships for.
     * @returns A promise.
     */
    listMemberships: async ({ userID }) => {
        return await zenHttpRequest('GET', `${runTimeVars.zendesk.remoteuri}/users/${userID}/organization_memberships.json`)
    },


    /**
     * Returns a list of all organizations. All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @returns Returns a promise
     */
    listOrganizations: async () => {
        return await zen_default_client.organizations.list()

    },


    /**
     * Returns a list of all phone numbers in the range [startingPage, startingPage+pageCount].
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     *
     * @param {boolean} minimalMode True if results should be minimized. Speeds up execution time.
     * @param {number} startingPage The page to start returning numbers from. 100 values per page.
     * @param {number} pageCount The number of pages to get.
     * @param {number} rateLimit (Optional) A number of milliseconds to wait beteween each page request. Must be >= 1000ms, and defaults to 1000ms.
     * 
     * @returns A promise.
     */
    listPhoneNumbers: async ({ minimalMode, startingPage, pageCount, rateLimit = 6000 }) => {
        rateLimit < 6000 ? rateLimit = 6000 : rateLimit
        let uri = `${runTimeVars.zendesk.remoteuri}/channels/voice/phone_numbers.json`
        let fetchOptions =
        {
            method: 'GET',
            headers: { 'Authorization': zen_auth },
        }

        return await zenOffsetPagination(uri, [`minimal_mode=${minimalMode}`], fetchOptions, 'phone_numbers', rateLimit, startingPage, pageCount)
    },


    /**
     * Returns a list of recordings by fetching ticket comments and filtering to voice recordings.
     * 
     * @param {string} ticketID The ticket ID to get recordings from
     * @returns A promise.
     */
    listRecordings: async ({ ticketID }) => {
        let result = await zen_default_client.tickets.getComments(ticketID)
        result = result.filter((obj) => obj.type === "VoiceComment")
        return result.map((obj) => {
            return {
                data: obj.data,
                via: obj.via
            }
        })
    },


    /** 
     * NOTE: There is no "listUsers" worker because there are 29,000+ users as of this writing. At 100 a page, thats 290 consecutive API calls. 
     * We'd wreck our limit if we called that with any sort of frequency.
     */


    /**
     * Returns a list of all ticket views
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @returns A promise.
     */
    listViews: async () => {
        return zen_default_client.views.list()
    },


    /**
     * Performs a search for tickets, users, and organizations. See the Zendesk API documentation for searchTerm formatting.
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} searchTerm The search query to send to Zendesk.
     * @returns A promise.
     */
    search: async ({ searchTerm }) => {
        return await zen_default_client.search.query(searchTerm)
    },


    /**
     * Sets an identity as the primary identity
     * 
     * @param {string} userID The user ID to to make an identity primary for
     * @param {string} identityID The identity ID to to make primary
     * @returns A promise
     */
    setPrimaryIdentity: async ({ userID, identityID }) => {
        return await zen_default_client.useridentities.makePrimary(userID, identityID)
    },


    /**
     * Shows the specified support email address.
     * 
     * @param {string} addressID The ID of the address to show.
     * @returns The requested support email address.
     */
    showAddress: async ({ addressID }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/recipient_addresses/${addressID}.json`
        return await zenHttpRequest("GET", uri)
    },


    /**
     * Shows an agent's availability status for ZD Talk
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} agentID The agent ID to show availability for.
     * @returns A promise.
     */
    showAvailabilities: async ({ agentID }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/channels/voice/availabilities/${agentID}.json`
        return await zenHttpRequest("GET", uri)
    },


    /**
     * Returns the status of a batch request for a given jobStatusID.
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} jobID The jobStatusID to show status for.
     * @returns A promise.
     */
    showJobStatus: async ({ jobID }) => {
        return await zen_default_client.jobstatuses.show(jobID)
    },


    /**
     * Returns information for a given organizationID.
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} organizationID The organizationID to show.
     * @param {Array} sideLoads An array of sideload endpoints to append to the API call.
     * @returns A promise.
     */
    showOrganization: async ({ organizationID, sideLoads }) => {
        if (sideLoads.length !== 0)
            zen_default_client.organizations.sideLoad = sideLoads //set sideloads if specified

        let rVal = await zen_default_client.organizations.show(organizationID)
        zen_default_client.organizations.sideLoad = [] //reset sideloads

        return rVal
    },

    /**
     * Shows information for an existing talk phone number.
     * 
     * @param {string} phoneNumberID The ID representing the phone number to update.
     * 
     * @returns The requested phone number.
     */
    showPhoneNumber: async ({ phoneNumberID }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/channels/voice/phone_numbers/${phoneNumberID}`
        return await zenHttpRequest("GET", uri)
    },


    /**
     * Returns information for a given ticketID.
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} ticketID The ticketID to show.
     * @param {Array} sideLoads An array of sideload endpoints to append to the API call.
     * @returns A promise.
     */
    showTicket: async ({ ticketID, sideLoads }) => {
        if (sideLoads.length !== 0)
            zen_default_client.tickets.sideLoad = sideLoads //set sideloads if specified

        let rVal = await zen_default_client.tickets.show(ticketID)
        zen_default_client.tickets.sideLoad = [] //reset sideloads

        return rVal
    },


    /**
     * Returns information for a given userID.
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} userID The userID to show.
     * @param {Array} sideLoads An array of sideload endpoints to append to the API call.
     * @returns A promise.
     */
    showUser: async ({ userID, sideLoads }) => {
        if (sideLoads.length !== 0)
            zen_default_client.users.sideLoad = sideLoads //set sideloads if specified

        let rVal = await zen_default_client.users.show(userID)
        zen_default_client.users.sideLoad = [] //reset sideloads

        return rVal
    },

    /**
     * Returns information for a given viewID
     * All variables should be passed as a JSON object and then will be destructured by the worker.
     * 
     * @param {string} viewID The viewID to show.
     * @returns A promise.
     */
    showView: async ({ viewID }) => {
        return await zen_default_client.views.show(viewID)
    },


    /**
     * Updates an existing support email.
     * 
     * @param {string} addressID The ID of the address to update
     * @param {Object} data The JSON formatted [address data](https://developer.zendesk.com/api-reference/ticketing/account-configuration/support_addresses/#json-format) to update.
     * Note: not all keys are updateable.
     * @returns The updated address entry.
     */
    updateAddress: async ({ addressID, data }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/recipient_addresses/${addressID}.json`
        return await zenHttpRequest("PUT", uri, { recipient_address: data })
    },


    /**
     * Updates an existing identity
     * 
     * @param {string} userID The user ID to to update the identity for
     * @param {string} identityID The identity ID to to update
     * @param {Object} data The [identity data](https://developer.zendesk.com/api-reference/ticketing/users/user_identities/#json-format) to update the identity with.
     * @returns A promise.
     */
    updateIdentity: async ({ userID, identityID, data }) => {
        return await zen_default_client.useridentities.update(userID, identityID, data)
    },


    /**
     * Updates a single Zendesk ticket.
     * 
     * @param {string} ticketID A single ticket ID.
     * @param {Object} data The ticket data to update the ticket with.
     * @returns A promise.
     */
    updateTicket: async ({ ticketID, data }) => {
        return await zen_default_client.tickets.update(ticketID, data)
    },


    /**
     * Updates one or more Zendesk tickets. If an array of ticketIDs is provided alongside a single JSON object for data then a bulk update is performed. 
     * If data is an array of JSON and ticketIDs is null or undefined, then a batch update is performed. See below for more information. 
     * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#update-many-tickets
     * 
     * @param {Object|Array} data The ticket data to update the ticket(s) with or an Array of up to 100 ticket JSON objects
     * @param {Array} ticketIDs An array of up to 100 ticket IDs.
     * 
     * @returns A [job status](https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/#json-format)
     */
    updateTickets: async ({ data, ticketIDs }) => {
        if (ticketIDs && data.ticket) {
            return await zen_default_client.tickets.updateMany(ticketIDs, data)
        } else if (!ticketIDs && data.tickets) {
            return await zenHttpRequest("PUT", `${runTimeVars.zendesk.remoteuri}/tickets/update_many.json`, data)
        } else {
            return Promise.reject(new Error("Invalid parameters for updateTickets."))
        }
    },


    /**
     * Updates a single Zendesk user.
     * 
     * @param {string} userID A single user ID.
     * @param {Object} data The user data to update the user with.
     * @returns A promise.
     */
    updateUser: async ({ userID, data }) => {
        return await zen_default_client.users.update(userID, data)
    },


    /**
     * Updates one or more Zendesk users. If an array of userIDs is provided alongside a single JSON object for data then a bulk update is performed. 
     * If data is an array of JSON and userIDs is null or undefined, then a batch update is performed. See below for more information. 
     * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#update-many-users
     * 
     * @param {Object|Array} data The user data to update the users(s) with or an Array of up to 100 user JSON objects
     * @param {Array} userIDs An array of up to 100 user IDs.
     * 
     * @returns A [job status](https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/#json-format)
     */
    updateUsers: async ({ data, userIDs }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/users/update_many.json`
        if (userIDs && data.user) {
            uri += `?ids=${userIDs.join(",")}`
            return await zenHttpRequest("PUT", uri, data)
        } else if (!userIDs && data.users) {
            return await zenHttpRequest("PUT", uri, data)
        } else {
            return Promise.reject(new Error("Invalid parameters for updateUsers."))
        }
    },


    /**
     * Updates a single Zendesk organization.
     * 
     * @param {string} organizationID A single organization ID.
     * @param {Object} data The organization data to update the organization with.
     * @returns A promise.
     */
    updateOrganization: async ({ organizationID, data }) => {
        return await zen_default_client.organizations.update(organizationID, data)
    },


    /**
     * Updates one or more Zendesk organizations. If an array of organizationsIDs is provided alongside a single JSON object for data then a bulk update is performed. 
     * If data is an array of JSON and organizationsIDs is null or undefined, then a batch update is performed. See below for more information. 
     * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#update-many-organizations
     * 
     * @param {Object|Array} data The organization data to update the users(s) with or an Array of up to 100 organization JSON objects
     * @param {Array} organizationIDs An array of up to 100 organization IDs.
     * 
     * @returns A [job status](https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/#json-format)
     */
    updateOrganizations: async ({ data, organizationIDs }) => {
        if (organizationIDs && data.organization) {
            return await zenHttpRequest("PUT", `${runTimeVars.zendesk.remoteuri}/organizations/update_many.json?ids=${organizationIDs.join(",")}`, data)
        } else if (!organizationIDs && data.organizations) {
            return await zen_default_client.organizations.updateMany(data)
        } else {
            return Promise.reject(new Error("Invalid parameters for updateTickets."))
        }
    },


    /**
     * Updates a Talk phone number.
     * 
     * @param {string} phoneNumberID The ID representing the phone number to update.
     * @param {Object} data The [phone number data](https://developer.zendesk.com/api-reference/voice/talk-api/phone_numbers/#json-format) to update the entry with
     * @returns The newly updated phone number.
     */
    updatePhoneNumber: async ({ phoneNumberID, data }) => {
        let uri = `${runTimeVars.zendesk.remoteuri}/channels/voice/phone_numbers/${phoneNumberID}`
        return await zenHttpRequest("PUT", uri, { phone_number: data })
    },

    /**
     * Verify an identity
     * 
     * @param {string} userID The user ID to to verify an identity for
     * @param {string} identityID The identity ID to to verify
     * @returns A promise
     */
    verifyIdentity: async ({ userID, identityID }) => {
        return await zen_default_client.useridentities.verify(userID, identityID)
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
 * }
 */
exports.zendeskLandingOnCall = functions.runWith(runtimeOpts540Sec8GB).https.onCall(async (data) => {
    if (!data || !data.dsk || data.dsk !== mySecretdsk) {
        return `Invalid Access Code. Access Denied`;
    }

    if (!data.worker || data.worker === ``) {
        return `No worker given. Aborting.`;
    }

    // console.log(JSON.stringify(data))

    /** This check was originally in place to prevent no arguments, but some list endpoints do not require any arguments (i.e. they only have optional arguments) */
    // if (!data.args || data.args.length === 0) {
    //     return `Must specify at least one argument in array format`;
    // }

    try {
        let result = await workers[data.worker](data.args);
        return deleteKeys(result, data.keysToDelete)
    }
    catch (err) {
        return err;
    }
});

// exports.zendeskLandingonRequest = functions.runWith(runtimeOpts30Sec2GB).https.onRequest(async (data) => {
// 	const myVar = "myValue";
// 	await new Promise((resolve) => setTimeout(resolve, 1000));
// 	return true;
//   });

//#endregion

//#region Supporting Functions

exports.processHeldTasks = async function (collectionName) {
    const reff = admin.firestore().collection(collectionName);
    const query = reff.where('status', '==', 'hold4conflict');
    const heldTasks = await query.get();

    var jobs = [];

    heldTasks.forEach(snapshot => {
        const snapID = snapshot.id;
        const jobber = snapshot.ref.update({
            status: 'scheduled'
        });
        jobs.push(jobber);
    });

    await Promise.all(jobs);
};

/**
 * Sends a generic request to the Zendesk API
 * 
 * @param {string} method The HTTP method to use
 * @param {string} uri The Zendesk URI to send the request to
 * @param {Object} body The body of the request to send to Zendesk. Defaults to undefined. Should be undefined if method is GET 
 * @returns A promise for the JSON response
 */
async function zenHttpRequest(method, uri, body = undefined) {
    if (!uri.includes(runTimeVars.zendesk.remoteuri))
        return Promise.reject(new Error("URI is not a valid Zendesk URI"))

    let options = {
        method: method,
        headers: { 'Authorization': zen_auth },
    }

    if (body) {
        options.body = JSON.stringify(body)
        options.headers['Content-Type'] = 'application/json'
    }


    try {
        const response = await fetch(uri, options)
        const responseType = response.headers.get("content-type")
        if (responseType && responseType.includes("application/json"))
            return response.json()
        else if (responseType && responseType.includes("text/plain"))
            return response.text()
        else
            return `${response.status}: ${response.statusText}`
    } catch (error) {
        return Promise.reject(error)
    }
}

/**
 * Automatically paginates through a offset-paginated endpoint, and reduces the pages to one result.
 * 
 * @param {string} uri The endpoint for the first page
 * @param {Array<string>} uriOptions Options for the URI besides the page number
 * @param {Object} options HTTP options for the fetch() function, including authorization and method 
 * @param {string} dataKey The full key path to the data from the root of the response page.
 * @param {number} rateLimit A number of milliseconds to delay between each page request. Required.
 * @param {number} startingPage The page to start from. 
 * @param {number} pageCount The total number of pages to fetch. Fetches the range: [startingPage, startingPage+pageCount]
 *
 * @returns the accumulated result of all pages in the range [startingPage, startingPage+pageCount], flattened into one array
 * 
 * @see https://developer.zendesk.com/documentation/developer-tools/pagination/comparing-cursor-pagination-and-offset-pagination/
 */
async function zenOffsetPagination(uri, uriOptions, options, dataKey, rateLimit, startingPage, pageCount) {
    if (rateLimit === null || rateLimit === undefined) throw new Error("A rate_limit is required for automatic pagination.")

    const recursivePaginate = async (next_page, i = 0, accumulator = []) => {
        if (next_page === null || i === pageCount)
            return accumulator

        try {
            let response = await fetch(`${next_page}${next_page.includes('?') ? '&' : '?'}${uriOptions.join('&')}`, options)
            if (response.ok) {
                let result = await response.json()
                next_page = result.next_page
                accumulator.push(result[dataKey])
                await sleep(rateLimit)
                return recursivePaginate(next_page, i += 1, accumulator)
            }
            else {
                throw new Error("Pagination response not OK.")
            }
        } catch (error) {
            console.error(error)
            return error
        }
    }

    var result = await recursivePaginate(`${uri}${startingPage ? `?page=${startingPage}` : ''}`)

    return result.flat()
}

/**
 * Automatically paginates through a time-paginated endpoint and reduces the results to one array. 
 * 
 * @param {*} uri The endpoint for the first page.
 * @param {*} startTime A unix timestamp to start from.
 * @param {*} dataKey The full key path to the data from the root of the response page.
 * @param {*} rateLimit A number of milliseconds to delay between each page request. Required.
 * @returns The accumulated result of all pages and the end_time (UNIX timestamp) 
 * 
 * @see https://developer.zendesk.com/documentation/ticketing/managing-tickets/using-the-incremental-export-api/#time-based-incremental-exports
 */
async function zenTimePagination(uri, startTime, dataKey, rateLimit) {
    if (rateLimit === null || rateLimit === undefined) throw new Error("A rate_limit is required for automatic pagination.");
    let counter = 0;

    const recursivePaginate = async (startTime, accumulator) => {
        try {
            let result = await zenHttpRequest("GET", `${uri}?start_time=${startTime}`);
            // console.log(`result: ${JSON.stringify(result)}`)
            if (result.end_of_stream || counter >= 20) {
                accumulator = [...accumulator, ...result[dataKey]];
                return { [dataKey]: accumulator, end_time: result.end_time };
            } else {
                counter += 1;
                await sleep(rateLimit);
                return recursivePaginate(result.end_time, [...accumulator, ...result[dataKey]]);
            }
        } catch (error) {
            console.error(`Error in recursivePaginate: ${error.message}`);
            return { [dataKey]: accumulator, error: `Error in recursivePaginate: ${error.message}` };
        }
    };

    try {
        var result = await recursivePaginate(startTime, []);
        return result;
    } catch (error) {
        console.error(`Error in zenTimePagination: ${error.message}`);
        return { error: `Error in zenTimePagination: ${error.message}` };
    }
}

// /**
//  * Automatically paginates through a time-paginated endpoint and reduces the results to one array.
//  *
//  * @param {*} uri The endpoint for the first page.
//  * @param {*} startTime A unix timestamp to start from.
//  * @param {*} dataKey The full key path to the data from the root of the response page.
//  * @param {*} rateLimit A number of milliseconds to delay between each page request. Required.
//  * @returns The accumulated result of all pages and the end_time (UNIX timestamp)
//  *
//  * @see https://developer.zendesk.com/documentation/ticketing/managing-tickets/using-the-incremental-export-api/#time-based-incremental-exports
//  */
// async function zenTimePagination(uri, startTime, dataKey, rateLimit) {
//     if (rateLimit === null || rateLimit === undefined) throw new Error("A rate_limit is required for automatic pagination.")
//     let counter = 0;
//     const recursivePaginate = async (startTime, accumulator) => {
//         let result = await zenHttpRequest("GET", `${uri}?start_time=${startTime}`)
//         // console.log(`result: ${JSON.stringify(result)}`)
//         if (result.end_of_stream || counter >= 20) {
//             accumulator = [...accumulator, ...result[dataKey]]
//             return { [dataKey]: accumulator, end_time: result.end_time }
//         }
//         else {
//             counter += 1;
//             await sleep(rateLimit)
//             return recursivePaginate(result.end_time, [...accumulator, ...result[dataKey]])
//         }
//     }

//     var result = await recursivePaginate(startTime, [])

//     return result
// }

//#endregion
