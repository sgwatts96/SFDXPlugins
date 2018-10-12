import { SfdxCommand, flags } from '@salesforce/command';
export default class Org extends SfdxCommand {
    static description: string;
    static examples: string[];
    protected static flagsConfig: {
        datafiles: flags.IOptionFlag<string>;
        dataplan: flags.IOptionFlag<string>;
    };
    protected static requiresUsername: boolean;
    run(): Promise<any>;
}
