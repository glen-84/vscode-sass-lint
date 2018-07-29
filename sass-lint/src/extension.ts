import {ExtensionContext, Uri, workspace, WorkspaceFolder} from "vscode";
import {
    CancellationToken,
    ConfigurationParams,
    LanguageClient,
    LanguageClientOptions,
    RequestType,
    ServerOptions,
    TextDocumentIdentifier,
    TransportKind,
    WorkspaceMiddleware
} from "vscode-languageclient";
import * as path from "path";

interface NoSassLintLibraryParams {
    readonly source: TextDocumentIdentifier;
}

// tslint:disable-next-line:no-namespace
namespace NoSassLintLibraryRequest {
    export const type = new RequestType<NoSassLintLibraryParams, {}, void, void>("sass-lint/noLibrary");
}

// Settings as defined in VS Code.
interface Settings {
    enable: boolean;
    configFile: string;
    resolvePathsRelativeToConfig: boolean;
    run: "onSave" | "onType";
    packageManager: "npm" | "yarn";
    nodePath: string | undefined;
    trace: "off" | "messages" | "verbose";
    workspaceFolderPath: string; // "virtual" setting sent to the server.
}

export function activate(context: ExtensionContext) {
    // The server is implemented in Node.
    const serverModule = context.asAbsolutePath(path.join("server", "sass-lint-server.js"));

    // The debug options for the server.
    const debugOptions = {
        execArgv: ["--nolazy", "--inspect=6010"]
    };

    // If the extension is launched in debug mode the debug server options are used, otherwise the run options are used.
    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.ipc
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client.
    const clientOptions: LanguageClientOptions = {
        // Register the server for Sass documents.
        documentSelector: [
            {language: "sass", scheme: "file"},
            {language: "scss", scheme: "file"}
        ],
        synchronize: {
            // Synchronize the setting section "sasslint" to the server.
            configurationSection: "sasslint",
            fileEvents: workspace.createFileSystemWatcher("**/.sass-lint.yml")
        },
        diagnosticCollectionName: "sass-lint",
        initializationFailedHandler: (error) => {
            client.error("Server initialization failed.", error);
            client.outputChannel.show(true);

            return false;
        },
        middleware: {
            workspace: {
                configuration: (
                    params: ConfigurationParams,
                    token: CancellationToken,
                    // tslint:disable-next-line:no-any
                    next: (params, token, next) => any[]
                // tslint:disable-next-line:no-any
                ): any[] => {
                    if (!params.items) {
                        return [];
                    }

                    const result = next(params, token, next);
                    let scopeUri = "";

                    for (const item of params.items) {
                        if (!item.scopeUri) {
                            continue;
                        } else {
                            scopeUri = item.scopeUri;
                        }
                    }

                    const resource = client.protocol2CodeConverter.asUri(scopeUri);
                    const workspaceFolder = workspace.getWorkspaceFolder(resource);

                    if (workspaceFolder) {
                        convertToAbsolutePaths(result[0], workspaceFolder);

                        if (workspaceFolder.uri.scheme === "file") {
                            result[0].workspaceFolderPath = workspaceFolder.uri.fsPath;
                        }
                    }

                    return result;
                }
            } as WorkspaceMiddleware
        }
    };

    function convertToAbsolutePaths(settings: Settings, folder: WorkspaceFolder) {
        const configFile = settings.configFile;
        if (configFile) {
            settings.configFile = convertAbsolute(configFile, folder);
        }

        const nodePath = settings.nodePath;
        if (nodePath) {
            settings.nodePath = convertAbsolute(nodePath, folder);
        }
    }

    function convertAbsolute(file: string, folder: WorkspaceFolder): string {
        if (path.isAbsolute(file)) {
            return file;
        }

        const folderPath = folder.uri.fsPath;
        if (!folderPath) {
            return file;
        }

        return path.join(folderPath, file);
    }

    // Create the language client and start it.
    const client = new LanguageClient("sasslint", "Sass Lint", serverOptions, clientOptions);
    client.registerProposedFeatures();

    client.onReady().then(() => {
        client.onRequest(NoSassLintLibraryRequest.type, (params) => {
            const uri: Uri = Uri.parse(params.source.uri);

            const workspaceFolder = workspace.getWorkspaceFolder(uri);
            const packageManager = workspace.getConfiguration("sasslint", uri).get("packageManager", "npm");

            client.info(getInstallFailureMessage(uri, workspaceFolder, packageManager));

            return {};
        });
    });

    function getInstallFailureMessage(
        uri: Uri,
        workspaceFolder: WorkspaceFolder | undefined,
        packageManager: string
    ): string {
        const localCommands = {
            npm: "npm install sass-lint",
            yarn: "yarn add sass-lint"
        };

        const globalCommands = {
            npm: "npm install -g sass-lint",
            yarn: "yarn global add sass-lint"
        };

        const localCmd = localCommands[packageManager];
        const globalCmd = globalCommands[packageManager];

        const failureMessage = `Failed to load the sass-lint library for the document "${uri.fsPath}"\n\n`;

        if (workspaceFolder) { // Workspace opened on a folder.
            return [
                failureMessage,
                `To use sass-lint in this workspace, install it using "${localCmd}", or globally using "${globalCmd}".`,
                "\n\nYou need to reopen the workspace after installing sass-lint."
            ].join("");
        } else {
            return [
                failureMessage,
                `To use sass-lint for a single file, install it globally using "${globalCmd}".`,
                "\n\nYou need to reopen VS Code after installing sass-lint."
            ].join("");
        }
    }

    client.start();
}
