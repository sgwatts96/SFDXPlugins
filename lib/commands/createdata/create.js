"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const command_1 = require("@salesforce/command");
const Util = require('util');
const fsExtra = require('fs-extra');
const tempDirectoryName = './tempFilesWithRecordTypes';
// Executes terminal commands
const exec = Util.promisify(require('child_process').exec);
// Initialize Messages with the current plugin directory
command_1.core.Messages.importMessagesDirectory(__dirname);
// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = command_1.core.Messages.loadMessages('dd', 'createdata');
class Org extends command_1.SfdxCommand {
    async run() {
        //Before doing anything get all record types from target Org
        const targetUserName = await this.org.getUsername();
        //Connect to Org
        const conn = this.org.getConnection();
        //Run Query for record types
        const recordTypeQuery = 'SELECT Id, SobjectType, DeveloperName FROM RecordType';
        const rtResults = await conn.query(recordTypeQuery);
        let rtMap = new Map();
        rtResults.records.forEach(recordType => {
            rtMap.set(recordType.SobjectType + '::' + recordType.DeveloperName, recordType.Id);
        });
        let allDataFiles = [];
        if (this.flags.datafiles) {
            await createTempDirectory();
            allDataFiles = this.flags.datafiles.split(',');
            importPromise(targetUserName, allDataFiles, rtMap, this.flags.datafiles, this.flags.dataplan, null);
        }
        else if (this.flags.dataplan) {
            let response = await processPlan(this.flags.dataplan);
            let updatedDataPlanName = response[0];
            allDataFiles = response[1];
            importPromise(targetUserName, allDataFiles, rtMap, this.flags.datafiles, this.flags.dataplan, updatedDataPlanName);
        }
    }
}
Org.description = messages.getMessage('commandDescription');
Org.examples = [
    `$ sfdx createdata:create -u myTargetOrg -f myExportedFile.json,myOtherExporedFile.json`,
    `$ sfdx createdata:create -u myTargetOrg -p myExporedPlan.json`
];
Org.flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    datafiles: command_1.flags.string({ char: 'f', description: messages.getMessage('dataFileFlagDescription') }),
    dataplan: command_1.flags.string({ char: 'p', description: messages.getMessage('dataPlanFlagDescription') })
};
Org.requiresUsername = true;
exports.default = Org;
async function processFile(file, fileName, rtMap, updatedFiles) {
    let parsedFile = JSON.parse(file);
    parsedFile.records.forEach(element => {
        if (element.hasOwnProperty('RecordType')) {
            let rtId = rtMap.get(element['attributes'].type + '::' + element['RecordType'].DeveloperName);
            element['RecordTypeId'] = rtId;
            delete element['RecordType'];
        }
    });
    let updatedFileName;
    if (fileName.includes('/') && fileName.lastIndexOf('/') > 1) {
        updatedFileName = fileName.substring(fileName.lastIndexOf('/') + 1, fileName.length - 5) + 'updated.json';
    }
    else {
        updatedFileName = fileName.substring(1, fileName.length - 5) + 'updated.json';
    }
    updatedFiles.set(updatedFileName, parsedFile);
    return updatedFiles;
}
async function processPlan(dataPlanFileName) {
    await createTempDirectory();
    //get base path for files based on plan
    let basePath = getBasePath(dataPlanFileName);
    let unparsedDataPlanFile = await command_1.core.fs.readFile(dataPlanFileName, 'utf-8');
    let planFilesToProcess = [];
    let dataPlanFile = JSON.parse(unparsedDataPlanFile);
    //update the file names with the temp files
    dataPlanFile.forEach(element => {
        let updatedFileNames = [];
        if (element.hasOwnProperty('files')) {
            element['files'].forEach(file => {
                //add the file to process
                planFilesToProcess.push(basePath + file);
                //update the filenames in the plan
                let updatedFileName;
                if (file.includes('/') && file.lastIndexOf('/') > 1) {
                    updatedFileName = file.substring(file.lastIndexOf('/') + 1, file.length - 5) + 'updated.json';
                }
                else {
                    updatedFileName = file.substring(0, file.length - 5) + 'updated.json';
                }
                updatedFileNames.push(updatedFileName);
            });
        }
        element['files'] = updatedFileNames;
    });
    //save the updated plan
    let updatedDataPlanName;
    if (dataPlanFileName.includes('/') && dataPlanFileName.lastIndexOf('/') > 1) {
        //set the updated dataplan name
        updatedDataPlanName = dataPlanFileName.substring(dataPlanFileName.lastIndexOf('/') + 1, dataPlanFileName.length - 5) + 'updated.json';
    }
    else {
        updatedDataPlanName = dataPlanFileName.substring(1, dataPlanFileName.length - 5) + 'updated.json';
    }
    await command_1.core.fs.writeFile('./tempFilesWithRecordTypes/' + updatedDataPlanName, JSON.stringify(dataPlanFile));
    return [updatedDataPlanName, planFilesToProcess];
}
function readInPlanFiles(allfiles, dataPlanFileName) {
    //get base path for files based on plan
    let basePath = '';
    if (dataPlanFileName.includes('/') && dataPlanFileName.lastIndexOf('/') > 1) {
        basePath = dataPlanFileName.substring(0, dataPlanFileName.lastIndexOf('/'));
    }
    //read in all the files
    allfiles.map(file => {
        return command_1.core.fs.readFile(basePath + '/' + file, 'utf-8');
    });
}
function importPromise(targetUserName, allDataFiles, rtMap, dataFileFlag, dataPlanFlag, dataPlanUpdatedFileName) {
    let fileNameToFile = new Map();
    Promise.all(
    //read in all the files
    allDataFiles.map(file => {
        return command_1.core.fs.readFile(file, 'utf-8');
    })).then(results => {
        throw ('my error');
        //create a map of file name to the actual file
        results.map((file, index) => {
            fileNameToFile.set(allDataFiles[index], file);
        });
    }).then(async () => {
        let updatedFiles = new Map();
        //Iterate through all files and update any record type Ids
        await fileNameToFile.forEach(async (value, key, map) => {
            updatedFiles = await processFile(value, key, rtMap, updatedFiles);
        });
        return updatedFiles;
    }).then(async (updatedFiles) => {
        await updatedFiles.forEach(async (value, key) => {
            await command_1.core.fs.writeFile('./tempFilesWithRecordTypes/' + key, JSON.stringify(value));
        });
        return updatedFiles;
    }).then(async (updatedFiles) => {
        //Run the actual sfdx import command with the updated files
        if (dataFileFlag) {
            let updatedFilesString = await getUpdatedFilesString(updatedFiles);
            await exec('sfdx force:data:tree:import -u ' + targetUserName + ' -f ' + updatedFilesString);
        }
        else if (dataPlanFlag) {
            await exec('sfdx force:data:tree:import -u ' + targetUserName + ' -p ' + './tempFilesWithRecordTypes/' + dataPlanUpdatedFileName);
        }
        return updatedFiles;
    }).then(async (updatedFiles) => {
        //Iterate over all updated files and remove them
        await updatedFiles.forEach((value, key) => {
            command_1.core.fs.unlink('./tempFilesWithRecordTypes/' + key);
        });
        if (dataPlanFlag) {
            command_1.core.fs.unlink('./tempFilesWithRecordTypes/' + dataPlanUpdatedFileName);
        }
        //Remove the temp directory
        command_1.core.fs.rmdir('./tempFilesWithRecordTypes');
    }).catch((e) => {
        console.log('I am in the catch' + e);
    });
}
async function createTempDirectory() {
    await command_1.core.fs.mkdirp(tempDirectoryName);
}
function getBasePath(dataPlanFileName) {
    if (dataPlanFileName.includes('/') && dataPlanFileName.lastIndexOf('/') > 1) {
        return dataPlanFileName.substring(0, dataPlanFileName.lastIndexOf('/') + 1);
    }
    else {
        return '';
    }
}
async function getUpdatedFilesString(updatedFiles) {
    let baseString = tempDirectoryName + '/';
    let combinedString = '';
    await updatedFiles.forEach((value, key) => {
        combinedString = combinedString.concat(baseString, key, ',');
    });
    combinedString = combinedString.substring(0, combinedString.length - 1);
    return combinedString;
}
async function cleanUpTempFilesAndDirecory() {
    fsExtra.remove(tempDirectoryName);
    fsExtra.remove('myMadeUpDirectory');
}
//# sourceMappingURL=create.js.map