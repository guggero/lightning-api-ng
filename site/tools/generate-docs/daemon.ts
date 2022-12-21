import fs from 'fs-extra';
import Handlebars from 'handlebars';
import path from 'path';
import { OUTPUT_DIR } from './constants';
import Enum from './enum';
import { Message } from './message';
import { Package } from './package';
import { RestTypes } from './rest-types';
import { templates } from './templates';
import { JsonDaemon } from './types';
import { pascalCase, snakeCase } from './utils';

const { log } = console;

interface FileRepoUrl {
  name: string;
  grpcUrl: string;
  restUrl: string;
}

interface ExperimentalService {
  name: string;
  lowerName: string;
  file: string;
}

interface RestEndpoint {
  restPath: string;
  restMethod: string;
  linkUrl: string;
  methodName: string;
}

export class Daemon {
  name: string;
  packages = new Map<string, Package>();
  restTypes: RestTypes;

  repoURL: string;
  commit: string;
  protoSrcDir: string;
  experimentalPackages: string[];
  grpcPort: number;
  restPort: number;
  cliCmd: string;
  daemonCmd: string;

  fileRepoUrls: FileRepoUrl[] = [];

  constructor(daemonName: string, json: JsonDaemon) {
    log(`Creating daemon ${daemonName} with ${json.files.length} proto files`);
    this.name = daemonName;
    this.restTypes = new RestTypes(json.restTypes);
    this.repoURL = json.repoURL;
    this.commit = json.commit;
    this.protoSrcDir = json.protoSrcDir;
    this.experimentalPackages = json.experimentalPackages;
    this.grpcPort = json.grpcPort;
    this.restPort = json.restPort;
    this.cliCmd = json.cliCmd;
    this.daemonCmd = json.daemonCmd;

    json.files.forEach((f) => {
      let pkg = this.packages.get(f.package);
      if (!pkg) {
        pkg = new Package(f.package, this);
        this.packages.set(f.package, pkg);
      }
      pkg.addProtoFile(f);

      if (this.experimentalPackages.includes(pkg.name)) {
        pkg.experimental = true;
      }

      // add the file name and repo url
      const { repoURL, commit, protoSrcDir } = this;
      const baseName = f.name.replace(/\.proto$/g, '');
      this.fileRepoUrls.push({
        name: baseName,
        grpcUrl: `${repoURL}/blob/${commit}/${protoSrcDir}/${baseName}.proto`,
        restUrl: `${repoURL}/blob/${commit}/${protoSrcDir}/${baseName}.swagger.json`,
      });
    });
    this.fileRepoUrls = this.fileRepoUrls.sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  get pascalName() {
    if (this.name === 'lnd') return 'LND';
    return pascalCase(this.name);
  }

  get experimentalServices() {
    const services: ExperimentalService[] = [];
    this.packages.forEach((pkg) => {
      if (pkg.experimental) {
        pkg.services.forEach((s) => {
          services.push({
            name: s.name,
            lowerName: s.name.toLowerCase(),
            file: s.fileName,
          });
        });
      }
    });
    return services.sort((a, b) => a.name.localeCompare(b.name));
  }

  get restEndpoints() {
    const endpoints: RestEndpoint[] = [];
    this.packages.forEach((pkg) => {
      pkg.services.forEach((service) => {
        service.methods.forEach((method) => {
          if (method.restMapping?.path) {
            endpoints.push({
              restPath: method.restMapping.path,
              restMethod: method.restMapping.method,
              linkUrl: `${snakeCase(service.name)}/${snakeCase(method.name)}`,
              methodName: `${pkg.name}.${method.name}`,
            });
          }
        });
      });
    });
    return endpoints.sort((a, b) => a.restPath.localeCompare(b.restPath));
  }

  getMessage(fullType: string, throwError = true) {
    // split "lnrpc.Invoice.InvoiceState" into "lnrpc" and "Invoice.InvoiceState"
    const period = fullType.indexOf('.');
    const pkgName = fullType.substring(0, period);
    const msgType = fullType.substring(period + 1);

    if (!this.packages.has(pkgName)) {
      if (throwError) {
        throw new Error(`Cannot find package ${pkgName} for ${fullType}`);
      } else {
        return;
      }
    }
    const pkg = this.packages.get(pkgName);

    if (!pkg.messages.has(msgType)) {
      if (throwError) {
        throw new Error(
          `Cannot find message ${msgType} for ${fullType} in the ${pkgName} package`
        );
      } else {
        return;
      }
    }
    const msg = pkg.messages.get(msgType);
    this.restTypes.updateMessage(msg);
    return msg;
  }

  getNestedMessages(message: Message, allMessages: Map<string, Message>) {
    message.fields
      .map((f) => f.fullType)
      // only include the non-native field types (ex: lnrpc.OutPoint)
      .filter((t) => t.includes('.'))
      // add the messages for each type
      .forEach((t) => {
        const msg = this.getMessage(t, false);
        // add the message to the map if it's not in there already
        if (msg) {
          // add the message to the map
          allMessages.set(t, msg);

          // add the nested messages for this message
          this.getNestedMessages(msg, allMessages);
        }
      });
  }

  getEnum(fullType: string, throwError = true) {
    // split "lnrpc.Invoice.InvoiceState" into "lnrpc" and "Invoice.InvoiceState"
    const period = fullType.indexOf('.');
    const pkgName = fullType.substring(0, period);
    const enumType = fullType.substring(period + 1);

    if (!this.packages.has(pkgName)) {
      if (throwError) {
        throw new Error(`Cannot find package ${pkgName} for ${fullType}`);
      } else {
        return;
      }
    }
    const pkg = this.packages.get(pkgName);

    if (!pkg.enums.has(enumType)) {
      if (throwError) {
        throw new Error(
          `Cannot find enum ${enumType} for ${fullType} in the ${pkgName} package`
        );
      } else {
        return;
      }
    }
    return pkg.enums.get(enumType);
  }

  getNestedEnums(message: Message, allEnums: Map<string, Enum>) {
    message.fields
      .map((f) => f.fullType)
      // only include the non-native field types (ex: lnrpc.OutPoint)
      .filter((t) => t.includes('.'))
      // add the messages for each type
      .forEach((t) => {
        const enu = this.getEnum(t, false);
        if (enu) {
          allEnums.set(t, enu);
          return;
        }
        // if the enum wasn't found, look for a nested message which
        // may have enum fields
        const msg = this.getMessage(t, false);
        if (msg) {
          // search the nested messages for more enums
          this.getNestedEnums(msg, allEnums);
        }
      });
  }

  exportMarkdown() {
    log(`Exporting daemon ${this.pascalName}`);

    this.packages.forEach((f) => f.exportMarkdown(this.name));

    // export a doc with the list of all rest paths
    const endpointsContent = Handlebars.compile(templates.rest_endpoints)(
      this,
      {
        allowProtoPropertiesByDefault: true,
      }
    );
    const endpointsFilePath = path.join(
      OUTPUT_DIR,
      this.name,
      'rest-endpoints.md'
    );
    fs.writeFileSync(endpointsFilePath, endpointsContent);

    // load the header for the daemon
    let content = templates.loadDaemonContent(this.name);
    if (!content) {
      content = `# ${this.pascalName}`;
    } else {
      content = Handlebars.compile(content)(this, {
        allowProtoPropertiesByDefault: true,
      });
    }

    const indexFilePath = path.join(OUTPUT_DIR, this.name, 'index.md');
    fs.writeFileSync(indexFilePath, content);
  }
}
