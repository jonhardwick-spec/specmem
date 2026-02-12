/**
 * TeamMemberCommands - multi-team member deployment and coordination
 *
 * Handles /specmem team-member commands for deploying and managing team member swarms
 */
import { CommandCategory, CommandAction, CommandResult } from './commandHandler.js';
import { DatabaseManager } from '../database.js';
export declare class TeamMemberCommands implements CommandCategory {
    private db;
    name: string;
    description: string;
    actions: Map<string, CommandAction>;
    constructor(db: DatabaseManager);
    private initializeActions;
    handleAction(action: string, args: string[]): Promise<CommandResult>;
    private handleDeploy;
    private handleList;
    private handleHelp;
    getHelp(): string;
}
//# sourceMappingURL=teamMemberCommands.d.ts.map