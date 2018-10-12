"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const command_1 = require("@salesforce/command");
// Initialize Messages with the current plugin directory
command_1.core.Messages.importMessagesDirectory(__dirname);
// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = command_1.core.Messages.loadMessages('dd', 'org');
class Org extends command_1.SfdxCommand {
    async run() {
        const name = this.flags.name || 'world';
        // this.org is guaranteed because requiresUsername=true, as opposed to supportsUsername
        const conn = this.org.getConnection();
        const query = 'Select Name, TrialExpirationDate from Organization';
        // Query the org
        const result = await conn.query(query);
        // Organization will always return one result, but this is an example of throwing an error
        // The output and --json will automatically be handled for you.
        if (!result.records || result.records.length <= 0) {
            throw new command_1.core.SfdxError(messages.getMessage('errorNoOrgResults', [this.org.getOrgId()]));
        }
        // Organization always only returns one result
        const orgName = result.records[0].Name;
        const trialExpirationDate = result.records[0].TrialExpirationDate;
        let outputString = `Hello ${name}! This is org: ${orgName}`;
        if (trialExpirationDate) {
            const date = new Date(trialExpirationDate).toDateString();
            outputString = `${outputString} and I will be around until ${date}!`;
        }
        this.ux.log(outputString);
        // this.hubOrg is NOT guaranteed because supportsHubOrgUsername=true, as opposed to requiresHubOrgUsername.
        if (this.hubOrg) {
            const hubOrgId = this.hubOrg.getOrgId();
            this.ux.log(`My hub org id is: ${hubOrgId}`);
        }
        if (this.flags.force && this.args.file) {
            this.ux.log(`You input --force and --file: ${this.args.file}`);
        }
        // Return an object to be displayed with --json
        return { orgId: this.org.getOrgId(), outputString };
    }
}
Org.description = messages.getMessage('commandDescription');
Org.examples = [
    `$ sfdx hello:org --targetusername myOrg@example.com --targetdevhubusername devhub@org.com
  Hello world! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  My hub org id is: 00Dxx000000001234
  `,
    `$ sfdx hello:org --name myname --targetusername myOrg@example.com
  Hello myname! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  `
];
Org.args = [{ name: 'file' }];
Org.flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    name: command_1.flags.string({ char: 'n', description: messages.getMessage('nameFlagDescription') }),
    force: command_1.flags.boolean({ char: 'f', description: messages.getMessage('forceFlagDescription') })
};
// Comment this out if your command does not require an org username
Org.requiresUsername = true;
// Comment this out if your command does not support a hub org username
Org.supportsDevhubUsername = true;
// Set this to true if your command requires a project workspace; 'requiresProject' is false by default
Org.requiresProject = false;
exports.default = Org;
//# sourceMappingURL=org.js.map