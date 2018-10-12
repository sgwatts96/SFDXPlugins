import { core, flags, SfdxCommand } from '@salesforce/command';
export default class Org extends SfdxCommand {
    static description: string;
    static examples: string[];
    static args: {
        name: string;
    }[];
    protected static flagsConfig: {
        name: flags.IOptionFlag<string>;
        force: import("../../../../../../../Users/work/Desktop/DeleteMe/node_modules/@salesforce/command/node_modules/@oclif/command/node_modules/@oclif/parser/lib/flags").IBooleanFlag<boolean>;
    };
    protected static requiresUsername: boolean;
    protected static supportsDevhubUsername: boolean;
    protected static requiresProject: boolean;
    run(): Promise<core.AnyJson>;
}
