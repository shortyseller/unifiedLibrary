// "use strict";
const admin = require("firebase-admin");
const functions = require("firebase-functions");

const runTimeVars = functions.config().envvars;
const mySecretdsk = runTimeVars.mySecret.dsk;

const { deleteKeys } = require("./shareableGlobalFunctions");

const google = require('@googleapis/drive')
const gauth = google.auth.fromJSON({
    "type": "service_account",
    "project_id": "mySecret-unified-library",
    "private_key_id": runTimeVars.google.drive.private_key_id,
    "private_key": runTimeVars.google.drive.private_key.replace(/\\\\n/g, "\n"),
    "client_email": runTimeVars.google.drive.client_email,
    "client_id": runTimeVars.google.drive.client_id,
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/google-drive%40mySecret-dealer-portal.iam.gserviceaccount.com",
})
gauth.scopes = ["https://www.googleapis.com/auth/drive"]
const drive = google.drive({
    version: 'v3',
    auth: gauth
})

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
 * Workers are named tasks that can be invoked when calling the firebase function. 
 * The worker name determines what function(s) will execute on the provided arguments.
 */
let workers = {

    /**
     * Performs a simple upload to google drive via the API
     * 
     * @param {JSON} fileMetadata Optional. The [metadata](https://developers.google.com/drive/api/v3/reference/files/create#request-body) for the file to be uploaded
     * @param {JSON} fileMedia The actual media to be uploaded. Consists of two keys: a [mimeType](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types) and body. All valid MIME types are supported. 
     * The body must be a [read stream](https://nodejs.org/api/fs.html#fscreatereadstreampath-options) for all media types except basic text files, for which it can be a string.
     *
     * @returns A Promise
     */
    createFile: async ({ fileMetadata, fileMedia }) => {
        return await drive.files.create({
            requestBody: fileMetadata,
            media: fileMedia
        })
    },


    /**
     * Creates an access permission for a file
     * 
     * @param {Object} permissionMetadata The [parameters](https://developers.google.com/drive/api/v3/reference/permissions/create#parameters) for the request.
     * @param {Object} requestBody The [body of the request](https://developers.google.com/drive/api/v3/reference/permissions/create#request-body)
     * 
     */
    createPermission: async ({ permissionMetadata, permissionBody }) => {
        return await drive.permissions.create({ ...permissionMetadata, requestBody: permissionBody })
    },


    /**
     * Deletes the specified file. Skips the trash.
     * 
     * @param {string} fileId The file ID to delete.
     * @returns A promise
     */
    deleteFile: async ({ fileId }) => {
        return await drive.files.delete({ fileId })
    },


    /**
     * Deletes a permission from a file.
     * 
     * @param {string} fileId The ID of the file to delete a permission from 
     * @param {string} permissionId The ID of the permission to delete
     * 
     * @returns An empty body if successful
     */
    deletePermission: async ({ fileId, permissionId }) => {
        return await drive.permissions.delete({ fileId, permissionId })
    },


    /**
     * Exports a Google Workspace document to the requested MIME type and returns exported byte content. Note that the exported content is limited to 10MB.
     * 
     * @param {string} fileId The id of the file to download
     * @param {string} mimeType The [mime type](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types) to download the file as.
     * @param {string} fields The paths of the fields you want included in the response. If not specified, the response includes a default set of fields specific to this method. For development you can use the special value * to return all fields, but you'll achieve greater performance by only selecting the fields you need. For more information, see Return specific fields for a file.
     * 
     * @returns Returns the file content as bytes.
     */
    exportFile: async ({ fileId, mimeType, fields }) => {
        return await drive.files.export({ fileId, mimeType, fields })
    },


    /**
     * Gets a file's metadata and contents (in the response body) by ID. To download Google Docs, Sheets, and Slides use exportFile instead.
     * 
     * @param {string} fileId The id of the file to download
     * @param {string} fields The paths of the fields you want included in the response. If not specified, the response includes a default set of fields specific to this method. For development you can use the special value * to return all fields, but you'll achieve greater performance by only selecting the fields you need. For more information, see Return specific fields for a file.
     * 
     * @returns Returns the file content as bytes.
     */
    getFile: async ({ fileId, fields }) => {
        return await drive.files.get({ fileId, fields, alt: 'media' })
    },


    /**
     * Gets the metadata for the specified file
     * 
     * @param {string} fileId 
     * @returns A promise
     */
    getFileMetadata: async ({ fileId, fields }) => {
        return await drive.files.get({ fileId, fields })
    },


    /**
     * 
     * @param {string} fileId The ID of the file to get a permission from 
     * @param {string} permissionId The ID of the permission to get
     * 
     * @returns A permission
     */
    getPermission: async ({ fileId, permissionId }) => {
        return await drive.permissions.get({ fileId, permissionId })
    },


    /**
     * Lists files matching the specified query and ordered by the specified ordering method/key(s).
     * 
     * @param {string} fields The paths of the fields you want included in the response. If not specified, the response includes a default set of fields specific to this method. For development you can use the special value * to return all fields, but you'll achieve greater performance by only selecting the fields you need.
     * @see https://developers.google.com/drive/api/guides/fields-parameter
     * @param {number} pageSize The maximum number of files to return per page. Partial or empty result pages are possible even before the end of the files list has been reached. Acceptable values are 1 to 1000, inclusive.
     * @param {string} query Query string for searching files.
     * @see https://developers.google.com/drive/api/guides/search-files
     * @param {string} orderBy A comma-separated list of sort keys. 
     * Valid keys are 'createdDate', 'folder', 'lastViewedByMeDate', 'modifiedByMeDate', 'modifiedDate', 'quotaBytesUsed', 'recency', 
     * 'sharedWithMeDate', 'starred', 'title', and 'title_natural'. Each key sorts ascending by default, but may be reversed with the 'desc' modifier.
     * Please note that there is a current limitation for users with approximately one million files in which the requested sort order is ignored.
     * @example
     *  '?orderBy=folder,modifiedDate desc,title'
     * @returns A promise
     */
    listFiles: async ({ fields, pageSize, query, orderBy }) => {
        return await drive.files.list({
            maxResults: pageSize,
            fields: fields,
            orderBy: orderBy,
            q: query
        })
    },


    /**
     * 
     * @param {string} fileId The ID of the file or shared drive to list permissions for.
     * @param {string} fields The paths of the fields you want included in the response. If not specified, the response includes a default set of fields specific to this method. For development you can use the special value * to return all fields, but you'll achieve greater performance by only selecting the fields you need.
     * @param {string} pageToken Optional. The token for continuing a previous list request on the next page. This should be set to the value of 'nextPageToken' from the previous response.
     * 
     * @returns A paginated object containing the array of permissions and a token to the next page. 
     */
    listPermissions: async ({ fileId, fields, pageToken }) => {
        return await drive.permissions.list({ fileId, fields, pageToken })
    },


    /**
     * Puts the specified file in the trash bin.
     * 
     * @param {string} fileId The file ID to trash.
     * @returns A promise
     */
    trashFile: async ({ fileId }) => {
        return await drive.files.update({ fileId, requestBody: { trashed: true } })
    },


    /**
     * Removes the specified file from the trash bin
     * 
     * @param {string} fileId The file ID to untrash.
     * @returns A promise
     */
    untrashFile: async ({ fileId }) => {
        return await drive.files.update({ fileId, requestBody: { trashed: false } })
    },


    /**
     * Permanently delets all of the user's trashed files.
     * 
     * @returns A empty body if successful.
     */
    emptyTrash: async () => {
        return await drive.files.emptyTrash()
    },


    /**
     * Update the metadata or media for a specific file
     * 
     * @param {string} fileId The ID of the file to update.
     * @param {JSON} fileMetadata Optional. The [metadata](https://developers.google.com/drive/api/v3/reference/files/create#request-body) for the file to be uploaded
     * @param {JSON} fileMedia The actual media to be uploaded. Consists of two keys: a [mimeType](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types) and body. All valid MIME types are supported. 
     * The body must be a [read stream](https://nodejs.org/api/fs.html#fscreatereadstreampath-options) for all media types except basic text files, for which it can be a string.
     * 
     * @returns A promise
     */
    updateFile: async ({ fileId, fileMetadata, fileMedia }) => {
        return await drive.files.update({
            fileId: fileId,
            requestBody: fileMetadata,
            media: fileMedia
        })
    },


    /**
     * Updates an existing permission.
     * 
     * @param {string} fileId The ID of the file to get a permission from.
     * @param {string} permissionId The ID of the permission to get.
     * @param {boolean} transferOwnership Whether to transfer ownership to the specified user and downgrade the current owner to a writer. [See more](https://developers.google.com/drive/api/v3/reference/permissions/update#parameters)
     * @param {Object} permissionBody The [body of the request](https://developers.google.com/drive/api/v3/reference/permissions/update#request-body).
     * 
     * @returns The updated permission
     */
    updatePermission: async ({ fileId, permissionId, transferOwnership, permissionBody }) => {
        return await drive.permissions.update({ fileId, permissionId, transferOwnership, requestBody: permissionBody })
    }
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
exports.googleDriveLandingOnCall = functions.runWith(runtimeOpts30Sec2GB).https.onCall(async (data) => {
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
        let result = await workers[data.worker](data.args);
        return deleteKeys(result, data.keysToDelete)
    }
    catch (err) {
        return err;
    }
});

//#endregion

//#region Supporting Functions

//Any supporting functions you may need should go here. Don't clutter the workers var with unneccessary functions.

//#endregion
