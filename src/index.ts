import * as core from '@actions/core';
import * as github from "@actions/github";
import * as fs from 'fs';
import * as plist from 'plist';
import { Minimatch } from "minimatch";
import propertiesReader from 'properties-reader';

process.on('unhandledRejection', handleError)
main().catch(handleError)

type ClientType = ReturnType<typeof github.getOctokit>;

async function main(): Promise<void> {
    let gradlePropertiesPath = core.getInput('gradle-properties-path');
    
    if (!fs.existsSync(gradlePropertiesPath)) {
        core.setFailed(`The file path for gradle.properties does not exist or is not found: ${gradlePropertiesPath}`);
        process.exit(1);
    }
    
    core.debug(`Running task with ${gradlePropertiesPath}`);

    const token = core.getInput("repo-token", { required: true });
    
    const prNumber = getPrNumber();
    if (!prNumber) {
        core.setFailed("Could not get pull request number from context, exiting");
        process.exit(1);
    }
    
    // let fileContent = fs.readFileSync(gradlePropertiesPath, { encoding: 'utf8' });
    // core.debug(gradlePropertiesPath);
    
    const properties = propertiesReader(gradlePropertiesPath);
    const versionName = properties.get('VERSION_NAME');
    
    core.info(`Read version number ${versionName} from gradle.properties`);
    
    const client: ClientType = github.getOctokit(token);
    
    let addLabel = true;
    const changedFilesConfig = core.getInput("changed-files", { required: false });
    if (changedFilesConfig) {
        const changedFiles: string[] = await getChangedFiles(client, prNumber);
        const matcher = new Minimatch(changedFilesConfig);
        if (!changedFiles.some(f => matcher.match(f))) {
            core.info(`No matching changes found in files at path ${changedFilesConfig}, skipping label.`);
            addLabel = false;
        }
    }
    
    let labelName = versionName;
    const labelFormat = core.getInput("label-format", { required: false });
    if (labelFormat) {
        labelName = labelFormat.replace('{version}', versionName);
    }

    if (addLabel) {
        await client.rest.issues.addLabels({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: prNumber,
            labels: [labelName],
        });
    }
}

function handleError(err: any): void {
    console.error(err)
    core.setFailed(`Unhandled error: ${err}`)
}

function getPrNumber(): number | undefined {
    const pullRequest = github.context.payload.pull_request;
    if (!pullRequest) {
        return undefined;
    }
    
    return pullRequest.number;
}

async function getChangedFiles(
    client: ClientType,
    prNumber: number
): Promise<string[]> {
    const listFilesOptions = client.rest.pulls.listFiles.endpoint.merge({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber,
    });
    
    const listFilesResponse = await client.paginate(listFilesOptions);
    const changedFiles = listFilesResponse.map((f: any) => f.filename);
    
    core.debug("Found changed files:");
    for (const file of changedFiles) {
        core.debug("  " + file);
    }
    
    return changedFiles;
}