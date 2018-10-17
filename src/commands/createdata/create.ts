import {core, SfdxCommand, flags} from '@salesforce/command';
import { compileFunction } from 'vm';
import { json } from '@salesforce/core';
import { resolve } from 'dns';
const Util = require('util')
const fsExtra = require('fs-extra')
const tempDirectoryName = './tempFilesWithRecordTypes'

//messages returned to the cli that are user friendly
let userMessages =  new Map();
  userMessages.set(0, 'Success: All records were deployed')
  userMessages.set(1, 'Error: No data was deployed - there are missing record types in your target org')
  userMessages.set(2, 'Error: There was an issue deploying the data')
  userMessages.set(3, 'Error: No data was deployed - there was an issue processing the plan file')
  userMessages.set(4, 'Error: No data was deployed - there was an issue processing the individual file(s)')
  userMessages.set(5, 'Error: No data was deployed - there was an issue deploying the data')




// Executes terminal commands
const exec = Util.promisify(require('child_process').exec)

// Initialize Messages with the current plugin directory
core.Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = core.Messages.loadMessages('dd', 'createdata');

export default class Org extends SfdxCommand {

  public static description = messages.getMessage('commandDescription');

  public static examples = [
  `$ sfdx createdata:create -u myTargetOrg -f myExportedFile.json,myOtherExportedFile.json
  Success: All records were deployed`,
  `$ sfdx createdata:create -u myTargetOrg -p myExportedPlan.json
  Success: All records were deployed`
  ];

  protected static flagsConfig = {
    //f: a string containing a single JSON data file or a comma separate list of files
    datafiles: flags.string({char: 'f', description: messages.getMessage('dataFileFlagDescription')}),

    //p: a string containing a single JSON data file that references multiple other JSON files
    dataplan: flags.string({char: 'p', description: messages.getMessage('dataPlanFlagDescription')})
  };

  //the target org
  protected static requiresUsername = true;

  public async run(): Promise<any> {

    //Before doing anything get all record types from target Org
    const targetUserName = await this.org.getUsername();
    const conn = this.org.getConnection();
    const recordTypeQuery = 'SELECT Id, SobjectType, DeveloperName FROM RecordType';
    const rtResults = await conn.query<any>(recordTypeQuery);
    
    //Put the record types into a map (objectName::DeveloperName, recordTypeId)
    let rtMap = new Map();
    rtResults.records.forEach(recordType =>{
         rtMap.set(recordType.SobjectType + '::' + recordType.DeveloperName, recordType.Id);
    });

    //Create a temporary directory where the updated files for import will be stored
    await createTempDirectory()

    //Array representing the individual files specified in this.flags.datafiles OR each file found in this.flags.dataplan
    let allDataFiles = [];

    if(this.flags.datafiles){

      //Split the incoming -f string by comma and add each file to the allDataFiles array
      allDataFiles = this.flags.datafiles.split(',');

      try{
        //Iterate over each file and replace each recordType attribute with a recordTypeId
        await processFiles(allDataFiles, rtMap)

        //Try to run the sfdx force:data:tree:import -f command
        let importResult = await importData(allDataFiles, null, targetUserName)

        //If we get here the data was deployed successfully thus inform the user and cleanup the temp directory
        this.ux.log(importResult)

        //Remove the temp directory and any files
        cleanUpTempFilesAndDirecory()
      }catch(err){

        //Remove the temp directory and any files
        cleanUpTempFilesAndDirecory()

        //Display any error message to the user
        this.ux.log(err.message)
      }
    } else if(this.flags.dataplan){

      try{
        //Read in the plan, extract the individual files from the plan, and update the plan with new file names
        allDataFiles = await processPlan(this.flags.dataplan)
        
        //Use the returned original files names from above and update them to remove any recordType attributes and replace them with recordTypeId
        await processFiles(allDataFiles, rtMap)

        //Try to run the sfdx force:data:tree:import -p command
        let importResult = await importData(allDataFiles, this.flags.dataplan, targetUserName)
        
        //If we get here the data was deployed successfully thus inform the user and cleanup the temp directory
        this.ux.log(importResult)

        //Remove the temp directory and any files
        cleanUpTempFilesAndDirecory()
      }catch(err) {
        //Remove the temp directory and any files
        cleanUpTempFilesAndDirecory()

        //Display any error message to the user
        this.ux.log(err.message)
      }
    }
  }
}

// async function processFile(file, fileName, rtMap, updatedFiles){
//   let parsedFile = JSON.parse(file);
//   parsedFile.records.forEach(element => {
//     if(element.hasOwnProperty('RecordType')){
//       if(rtMap.has(element['attributes'].type+'::'+element['RecordType'].DeveloperName)){
//         let rtId = rtMap.get(element['attributes'].type+'::'+element['RecordType'].DeveloperName);
//         element['RecordTypeId'] = rtId;
//         delete element['RecordType'];
//       } else{
//         throw new Error(userMessages[1])
//       }
//     }
//   })

//   let updatedFileName;

//   if(fileName.includes('/') && fileName.lastIndexOf('/') > 1){
//     updatedFileName = fileName.substring(fileName.lastIndexOf('/') + 1, fileName.length - 5) + 'updated.json';
//   } else {
//     updatedFileName = fileName.substring(1, fileName.length - 5) + 'updated.json';
//   }

//   updatedFiles.set(updatedFileName, parsedFile)

//   return updatedFiles
// }

/**
 * @description main function that creates a copy of the of the individual import files and replaces the recordType element
 *              with a recordTypeId element based on the rtMap paramenter. Once the files have been udpated they are saved 
 *              to the temp directory such that they can be imported using the sfdx force:data:tree:import command (run separately)
 * @param allDataFileNames an array of strings representing the original names of the files for import
 * @param rtMap a map of (ObjectName + :: + RecordTypeDeveloperName TO RecordTypeId) from the target org
 */
async function processFiles(allDataFiles, rtMap){
  return Promise.all(
    //Read in all the files
    allDataFiles.map(file => {
      return readFile(file, 'utf-8')
    })
  ).then(results => {
    
    return results.map((file) => {
      let parsedFile = JSON.parse(<string> file)

      parsedFile.records.forEach(element => {
        if(element.hasOwnProperty('RecordType')){
          if(rtMap.has(element['attributes'].type+'::'+element['RecordType'].DeveloperName)){
            let rtId = rtMap.get(element['attributes'].type+'::'+element['RecordType'].DeveloperName)
            element['RecordTypeId'] = rtId
            delete element['RecordType']

            return parsedFile
          } else{
            throw new Error(userMessages.get(1))
          }
        }
      })
      return parsedFile
    })
  }).then(async (results) => {

    return await results.map(async (file, index) => {
      let updatedFileName = await getUpdatedFileName(allDataFiles[index], true)
      
      return await writeFile(updatedFileName, file)
    })
  }).catch((err) => {
    throw new Error(userMessages.get(4))
  })
}

// async function processPlan(dataPlanFileName){
  
//   //get base path for files based on plan
//   let basePath = getBasePath(dataPlanFileName)

//   //let unparsedDataPlanFile = await core.fs.readFile(dataPlanFileName, 'utf-8')
//   let unparsedDataPlanFile = await readFile(dataPlanFileName, 'utf-8')

//   let planFilesToProcess = [];
//   let dataPlanFile = JSON.parse(unparsedDataPlanFile.toString());

//   //update the file names with the temp files
//   dataPlanFile.forEach(element => {
//     let updatedFileNames = [];
//     if(element.hasOwnProperty('files')){
//       element['files'].forEach(file => {

//         //add the file to process
//         planFilesToProcess.push(basePath + file);

//         //update the filenames in the plan
//         let updatedFileName;
//         if(file.includes('/') && file.lastIndexOf('/') > 1){
//           updatedFileName = file.substring(file.lastIndexOf('/') + 1, file.length - 5) + 'updated.json';
//         } else {
//           updatedFileName = file.substring(0, file.length - 5) + 'updated.json';
//         }

//         updatedFileNames.push(updatedFileName);
//       }) 
//     }
//     element['files'] = updatedFileNames;
//   })

//   //save the updated plan
//   let updatedDataPlanName;
//   if(dataPlanFileName.includes('/') && dataPlanFileName.lastIndexOf('/') > 1){
//     //set the updated dataplan name
//     updatedDataPlanName = dataPlanFileName.substring(dataPlanFileName.lastIndexOf('/') + 1, dataPlanFileName.length - 5) + 'updated.json';
//   } else {
//     updatedDataPlanName = dataPlanFileName.substring(1, dataPlanFileName.length - 5) + 'updated.json';
//   }
//   await core.fs.writeFile('./tempFilesWithRecordTypes/'+ updatedDataPlanName, JSON.stringify(dataPlanFile));
  
//   return [updatedDataPlanName, planFilesToProcess];
// }

/**
 * @description main function used to process data import plans. This function creates a copy of the original data plan,
 *              updates the file with new file names (the new files will be created later) that have RecordTypeIds. Once
 *              the files names have been udpated the plan is saved to the temp directory and this function returns an array
 *              or strings such that the plugin can iterate over those individual files and update them with RecordTypeIds.
 * @param allDataFileNames an strings representing the original name (full path) of the plan that need to be updated
 * @returns an array of strings representing the file names (full path) of the files contained within the plan that need
 *          to be updated with RecordTypeIds
 */
async function processPlan(dataPlanFileName){

  return new Promise(async (resolve, reject) => {
    //read in the files
    resolve (readFile(dataPlanFileName, 'utf-8'))

  }).then(async (result) => {

    //get base path for files based on plan
    const basePath = getBasePath(dataPlanFileName)

    const dataPlanFile = JSON.parse(result.toString());
    
    const planFilesToProcess = dataPlanFile.map(record => record.files.map(file => basePath + file)).reduce((acc, val) => acc.concat(val), [])

    const updatedPlanFile = dataPlanFile.map(record => {
      if(record.hasOwnProperty('files')) {
        record.files = record.files.map(file => getUpdatedFileName(file, false))
      }
      return record
    })
    
    const response = {'Plan': updatedPlanFile, 'Files': planFilesToProcess};
    return response
  }).then(async (result) => {

    //Get the updated plan name
    let updatedDataPlanName = getUpdatedFileName(dataPlanFileName, true)

    //Save the updated plan
    writeFile(updatedDataPlanName,result['Plan'])

    //Return an array of strings containing the individual files that need to be updated from the plan
    return result['Files']

  }).catch((err) => {
    throw new Error(userMessages.get(3))
  })
}

/**
 * @description main function that runs the sfdx force:data:tree:import command using the updated files (either the plan
 *              or individual files) within the temp directory
 * @param allDataFileNames (optional) an array of strings representing the original names of the files for import
 * @param dataPlanName (optional) a string reprenting the original file name of the plan for import
 * @param targetUserName the credentials for the target org where the data is to be deployed
 * @returns a String the success or error message
 */
async function importData(allDataFileNames, dataPlanName, targetUserName){
  return new Promise (async (resolve, reject) => {
    if(dataPlanName) {
      let updatedPlanName = await getUpdatedFileName(dataPlanName, true)
      resolve(updatedPlanName) 
    } else {
      let updatedFilenames = await getUpdatedFilesString(allDataFileNames)
      resolve(updatedFilenames)
    }
  }).then(async (importString) => {
    //Run the actual sfdx import command with the updated files
    if(!dataPlanName) {
      await exec('sfdx force:data:tree:import -u ' + targetUserName + ' -f ' + importString)
    } else {
      await exec('sfdx force:data:tree:import -u ' + targetUserName + ' -p ' + importString)
    }
  }).then(() => {
    return userMessages.get(0)
  }).catch(() => {
    throw new Error(userMessages.get(2))
  })
}

// function importPromise(targetUserName, allDataFiles, rtMap, dataFileFlag, dataPlanFlag, dataPlanUpdatedFileName){
//   let fileNameToFile = new Map();

//   return Promise.all(
//     //read in all the files
//     allDataFiles.map(file => {
//       return core.fs.readFile(file, 'utf-8');
//     })
//   ).then(results => {
//     //create a map of file name to the actual file
//     results.map((file, index) => {
//       fileNameToFile.set(allDataFiles[index], file);
//     })
//   }).then(async () => {
//     let updatedFiles = new Map();
//     //Iterate through all files and update any record type Ids
//     try{
//       await fileNameToFile.forEach(async (value, key, map) => {
//         updatedFiles = await processFile(value, key, rtMap ,updatedFiles); 
//       })} catch(e){
//         throw new Error(e.message)
//     }
//     return updatedFiles       
//   }).then(async (updatedFiles) => {
//     await updatedFiles.forEach(async (value, key) => {
//       await core.fs.writeFile('./tempFilesWithRecordTypes/'+ key, JSON.stringify(value));
//     })
//     return updatedFiles
//   }).then(async updatedFiles => {
//     //Run the actual sfdx import command with the updated files
//     if(dataFileFlag){
//       let updatedFilesString = await getUpdatedFilesString(updatedFiles)
//       //await exec('sfdx force:data:tree:import -u ' + targetUserName + ' -f ' + updatedFilesString);
//     } else if(dataPlanFlag){
//      // await exec('sfdx force:data:tree:import -u ' + targetUserName + ' -p ' + './tempFilesWithRecordTypes/' + dataPlanUpdatedFileName);
//     }
//     return updatedFiles
//   }).then(async (updatedFiles) => {
//     //Delete any temp files or directories
//     cleanUpTempFilesAndDirecory()

//     //return a success message
//     return userMessages[0]
//   }).catch((e) => {
//     //Delete any temp files or directories
//     cleanUpTempFilesAndDirecory()

//     //return error message to be displayed
//     return e.message
//   })
// }

/**
 * @description Creates a diretory wherever this command is run which will house the temporary files with updated recordTypeIds
 */
async function createTempDirectory() {
  await core.fs.mkdirp(tempDirectoryName);
}

/**
 * @description helper function to read in an individual file
 * @param filePath the full path to the local file
 * @param encoding the encoding for local file (assumption is uft-8)
 * @return buffer containing the read file  (assumption is all files are JSON thus can be parsed to string)
 */
async function readFile(filePath, encoding) {
  return await core.fs.readFile(filePath, encoding);
}

/**
 * @description helper function to write a file to the local temp directory such that you can use those files for the sfdx force:data:tree:import command
 * @param fileName the full path (including the file name)
 * @param file the actual data of the file (assumpion is it is a JSON file)
 */
async function writeFile(fileName, file){
  await core.fs.writeFile(fileName, JSON.stringify(file))
}

/**
 * @description helper function to rename files to be added to the temp directory
 * @param fileName a string representing the original file name
 * @param includeBaseDirectory  a boolean to specify if you want the full path for the updated name, or just updated name of the file
 *                              this is needed because a plan use local file names (ie same directory as the plan file) where as
 *                              if you import individual files they can come from anywhere
 * @returns string of the updated file name (this can be just the file name or the whole path to the file)
 */
function getUpdatedFileName(fileName, includeBaseDirectory) {
  let baseString = ''
  if(includeBaseDirectory){
    baseString = tempDirectoryName + '/'
  }
   
  if(fileName.includes('/') && fileName.lastIndexOf('/') > 1){
    let updatedFileName = fileName.substring(fileName.lastIndexOf('/') + 1, fileName.length - 5)
    return baseString.concat(updatedFileName, 'updated.json')
  } else{
    let updatedFileName = fileName.substring(0, fileName.length - 5)
    return baseString.concat(updatedFileName, 'updated.json')
  }
}

/**
 * @description helper function to find the base path where the plugin command was run
 * @param dataPlanFileName a string representing the this.flags.dataplan variable
 * @returns string representing the basepath
 */
function getBasePath(dataPlanFileName){
  if(dataPlanFileName.includes('/') && dataPlanFileName.lastIndexOf('/') > 1){
    return dataPlanFileName.substring(0, dataPlanFileName.lastIndexOf('/') + 1)
  } else{
    return ''
  }
}

/**
 * @description helper function to create a comma separate string of files or plan that is used in the call to sfdx force:data:tree:import command
 * @param allDataFiles an array of strings representing the original files names or plan
 * @returns comma separated string of updated files or plan (full path) from the temp directory
 */
async function getUpdatedFilesString(allDataFiles){
   return Promise.all( 
    allDataFiles.map(file => {
      return getUpdatedFileName(file, true) 
    })
  ).then(results => {
    //combine all updated file names into a single string
    let combined = results.join()

    return combined
  }).catch(() => {
    throw new Error(userMessages.get(2))
  })
}

/**
 * @description helper function that removes the temporary directory (and any files within) created at the beginning of the process
 */
async function cleanUpTempFilesAndDirecory(){
  fsExtra.remove(tempDirectoryName)
}