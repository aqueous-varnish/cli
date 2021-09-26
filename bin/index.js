#!/usr/bin/env node

const updateNotifier = require('update-notifier');
const pkg = require('../package.json');
updateNotifier({ pkg }).notify();

const { Command } = require('commander');
const ora = require('ora');
const Constants = require('./Constants');
const Web3 = require('web3');
const AQVS = require('@aqueous-varnish/client');
const globby = require('globby');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

// TODO Spaces

// Web3 Provider
// [owner] add-cors-domain <url>
// [owner] remove-cors-domain <url>
// [owner] make-token <spaceAddress>
// [owner] revoke-token <spaceAddress>

const {
  testSession,
  fetchCurrentSession,
  deleteSession,
  validateOrInitiateSession,
  promptUserToMintSpace,
  attemptInMetamask
} = require('./lib/sessionHelpers');

const {
  stringToStorageSpaceAsBytes,
  stringToCostAsWei,
  stringToInt
} = require('./lib/validators');


const Strings = {
  STARTING: 'Starting...',
  NO_SESSION: 'Your session session has expired. Please use "aqvs make-session"',
  SUCCESS: 'Success.',
  ERROR: 'Error!'
};

const handleError = async (spinner, e) => {
  spinner.fail(e && e.message || 'Error.');
  if (typeof e.json === 'function') {
    console.log(await e.json());
  }
  return e;
};

const program = new Command();
program.version(pkg.version);

const setupCLI = async () => {
  await AQVS.setTruffleContract(require('@truffle/contract'));
  await AQVS.setEnv(program.opts().env || 'mainnet');
  await AQVS.setFetch(require('node-fetch'));
  if (program.opts().httpProvider) {
    await AQVS.setWeb3(new Web3(new Web3.providers.HttpProvider(program.opts().httpProvider)));
  }
  return AQVS;
};

const getEnv = (env) => {
  const envConstants = Constants[env || 'mainnet'];
  if (!envConstants) throw new Error("invalid_env");
  return envConstants;
};

program
  .option('-e, --env <env>', 'Environment to use. Defaults to mainnet.')
  .option('-p, --http-provider <httpProvider>', 'Optional Web3 Provider to use. Defaults to metamask.');

program
  .command('make-session')
  .description('Start a new CLI session')
  .action(async () => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();
    try {
      const currentSession = await validateOrInitiateSession(AQVS);
      return spinner.succeed(`${Strings.SUCCESS} Operating as ${currentSession.publicAddress}.`);
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`current-session`)
  .description(`Show the address for the current session owner`)
  .action(async () => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();
    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);
      return spinner.succeed(`${Strings.SUCCESS} Operating as ${currentSession.publicAddress}.`);
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`flush-session`)
  .description(`Flush the current session`)
  .action(async () => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();
    try {
      await deleteSession(AQVS);
      return spinner.succeed(Strings.SUCCESS);
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`list-minted-spaces`)
  .description(`List spaces created by the current session`)
  .action(async () => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);

      let spaceAddresses;
      if (AQVS._web3) {
        spaceAddresses = await AQVS.spaces.getSpacesCreatedBy(currentSession.publicAddress);
      } else {
        spaceAddresses = (await attemptInMetamask(AQVS, 'list-minted-spaces', {
          creator: currentSession.publicAddress
        })).results;
      }

      spinner.succeed(Strings.SUCCESS);
      if (spaceAddresses.length) {
        return spaceAddresses.forEach(r => console.log(`> ${r}`));
      } else {
        return console.log('No spaces (yet).');
      }
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`get-space-info <spaceAddress>`)
  .description(`Get information about a Space`)
  .action(async (spaceAddress) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      let spaceInfo;
      if (AQVS._web3) {
        // TODO
      } else {
        spaceInfo = (await attemptInMetamask(AQVS, 'get-space-info', {
          spaceAddress: spaceAddress
        })).results;
      }

      spinner.succeed(Strings.SUCCESS);
      console.log(spaceInfo);
      return;
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`mint-space <initialSupply> <storageSize> <accessCost> <purchasable>`)
  .description(`Mint a space as an NFT to publish content to`)
  .action(async (initialSupply, storageSpace, accessCost, purchasable) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    const initialSupplyAsInt = stringToInt(initialSupply);
    if (!initialSupplyAsInt) {
      return spinner.warn('Invalid initial supply. Please pass an int.');
    }
    const storageSpaceAsBytes = stringToStorageSpaceAsBytes(storageSpace);
    if (!storageSpaceAsBytes) {
      return spinner.warn('Invalid storage size. Please use a unit like 1gb, 256mb, 32kb or 1000b.');
    }
    const accessCostAsWei = stringToCostAsWei(accessCost);
    if (!accessCostAsWei) {
      return spinner.warn('Invalid access cost. Please use a web3 compatible unit like 0.1ether or 200gwei.');
    }

    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);

      let mintedSpaceAddress;
      if (AQVS._web3) {
        // TODO
      } else {
        const { spaceAddress } = (await attemptInMetamask(AQVS, 'mint-space', {
          initialSupply: initialSupplyAsInt,
          storageSpace: storageSpaceAsBytes,
          accessCost: accessCostAsWei,
          purchasable: purchasable
        })).results;
        mintedSpaceAddress = spaceAddress
      }

      return spinner.succeed(`${Strings.SUCCESS} Minted Space Address: ${mintedSpaceAddress}`);
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`get-space-metadata <spaceAddress>`)
  .description(`Get ERC721 compliant metadata for a Space`)
  .action(async (spaceAddress) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      const res = await AQVS.spaces.getSpaceMetadata(spaceAddress);
      if (res.status === 200) {
        spinner.succeed(Strings.SUCCESS);
        return console.log(await res.json());
      } else if (res.status === 404) {
        spinner.succeed(Strings.SUCCESS);
        return console.log('No metadata set.');
      } else {
        throw res;
      }
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`set-space-metadata <spaceAddress> <name> <description> [image]`)
  .description(`Set ERC721 compliant metadata for a Space`)
  .action(async (spaceAddress, name, description, image) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);
      const res = await AQVS.creators.setSpaceMetadata(spaceAddress, {
        name, description, image
      }, currentSession.cookie);
      if (res.status === 200) {
        return spinner.succeed(Strings.SUCCESS);
      } else {
        throw res;
      }
      return;
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`add-cors-domain <spaceAddress> <domain>`)
  .description(`Add a domain that allows downloads from this space`)
  .action(async () => {
    // TODO
  });

program
  .command(`remove-cors-domain <spaceAddress> <domain>`)
  .description(`Remove a domain that allows downloads from this space`)
  .action(async () => {
    // TODO
  });

program
  .command(`gift-space-access <spaceAddress> <gifteeAddress>`)
  .description(`Gift space access to another address`)
  .action(async (spaceAddress, gifteeAddress) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      let res;
      if (AQVS._web3) {
        // TODO
      } else {
        res = (await attemptInMetamask(AQVS, 'gift-space-access', {
          spaceAddress, gifteeAddress
        })).results;
      }

      if (res.status === "ok") {
        return spinner.succeed(Strings.SUCCESS);
      } else if (res.status === "already_owns_space") {
        return spinner.succeed(`${Strings.SUCCESS} This address can already access this space.`);
      } else if (res.status === "sold_out") {
        return spinner.fail(`${Strings.ERROR} This space is sold out.`);
      } else {
        throw res;
      }
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`add-space-capacity <spaceAddress> <additionalStorageSpace>`)
  .description(`Add space capacity to an existing space`)
  .action(async (spaceAddress, additionalStorageSpace) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    const storageSpaceAsBytes = stringToStorageSpaceAsBytes(additionalStorageSpace);
    if (!storageSpaceAsBytes) {
      return spinner.warn('Invalid storage size. Please use a unit like 1gb, 256mb, 32kb or 1000b.');
    }

    try {
      let res;
      if (AQVS._web3) {
        // TODO
      } else {
        res = (await attemptInMetamask(AQVS, 'add-space-capacity', {
          spaceAddress,
          storageSpace: storageSpaceAsBytes,
        })).results;
      }

      if (res.status === "ok") {
        return spinner.succeed(Strings.SUCCESS);
      } else {
        throw res;
      }
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`set-purchasable <spaceAddress> <purchasable>`)
  .description(`Add space capacity to an existing space`)
  .action(async (spaceAddress, purchasable) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);

      let res;
      if (AQVS._web3) {
        // TODO
      } else {
        res = (await attemptInMetamask(AQVS, 'set-purchasable', {
          spaceAddress, purchasable, from: currentSession.publicAddress
        })).results;
      }

      if (res.status === "ok") {
        return spinner.succeed(Strings.SUCCESS);
      } else {
        throw res;
      }
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`filetree <spaceAddress>`)
  .description(`Get the filetree for a space that you can access`)
  .action(async (spaceAddress) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);
      const res = await AQVS.spaces.getSpaceContents(spaceAddress, currentSession.cookie);
      if (res.status === 200) {
        spinner.succeed(Strings.SUCCESS);
        return console.log(await res.json());
      } else {
        throw res;
      }
      return;
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`sync-folder <spaceAddress> <folderPath>`)
  .description(`Publish files and folders to a space that you've minted`)
  .action(async (spaceAddress, folderPath) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);

      const fullPath = path.join(process.cwd(), folderPath);
      if (fs.lstatSync(fullPath).isFile()) {
        throw new Error("must_be_folder_path");
      }

      const paths = await globby(['**/*'], {
        cwd: fullPath,
        ignore: ['node_modules/**/*', '.git/**/*']
      });
      const formData = new FormData();
      paths.forEach(filePath => {
        formData.append(
          `/${filePath}`, fs.createReadStream(path.join(process.cwd(), folderPath, filePath))
        );
      });

      const res = await AQVS.creators.uploadFilesToSpace(
        spaceAddress,
        formData,
        currentSession.cookie
      );

      if (res.status === 200) {
        spinner.succeed(Strings.SUCCESS);
        return console.log(await res.json());
      } else {
        throw res;
      }
      return;
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program
  .command(`delete-file <spaceAddress> <filePath>`)
  .description(`Delete a file from the space`)
  .action(async (spaceAddress, filePath) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);

      const res = await AQVS.creators.deleteFileInSpace(
        spaceAddress,
        filePath,
        currentSession.cookie
      );
      if (res.status === 200) {
        return spinner.succeed(Strings.SUCCESS);
      } else {
        throw res;
      }
      return;
    } catch(e) {
      handleError(spinner, e);
    }
  });

program
  .command(`delete-all-files <spaceAddress>`)
  .description(`Clear all files from a space`)
  .action(async (spaceAddress) => {
    const spinner = ora(Strings.STARTING).start();
    await setupCLI();

    try {
      const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
      if (!currentSession) return spinner.fail(Strings.NO_SESSION);

      const res = await AQVS.creators.deleteAllFilesInSpace(
        spaceAddress,
        currentSession.cookie
      );
      if (res.status === 200) {
        return spinner.succeed(Strings.SUCCESS);
      } else {
        throw res;
      }
      return;
    } catch(e) {
      return handleError(spinner, e);
    }
  });

program.parse(process.argv);
