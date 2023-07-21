const config = require('./config.json');
const HACClient = require('./hac-client');
const readline = require('readline');
const colors = require('colors');

// TODO: turn this into a npm global module which could be used anywhere in CLI

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ENVIRONMENT = config.environment;

if (ENVIRONMENT === "local") {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0
}

const clients = [];

for (const clientConfig of config.environments[ENVIRONMENT]) {
  const client = new HACClient(clientConfig);
  clients.push(client);
}

async function processInput(input) {
  const [command, ...args] = input.trim().split(' ');

  // TODO: manage this from something like "command manager"
  switch (command) {
    case 'find': {
      const fileName = args[0];
      console.log(`Searching [${fileName}] through clients...`.yellow);

      for (const client of clients) {
        if (client.isLoggedIn) {
          const files = client.searchFile(fileName);
        }
      }

      break;
    }
    case 'download': {
      const fileName = args[0];
      console.log(`Downloading [${fileName}] from all clients...`.yellow);
      for (let client of clients) {
        if (client.isLoggedIn) {
          await client.downloadFile(fileName);
        }
      }
      console.log(`Download completed on all clients!`.green);
      break;
    }
    case 'exit':
      rl.close();
      break;
    default:
      console.log('Unknown command:', command);
      break;
  }
}

function getInput() {
  return new Promise((resolve) => {
    rl.question('', resolve);
  });
}

async function main() {
  console.log("Getting files...".yellow);

  await Promise.all(clients.map((client) => client.getFiles()));

  console.log("You can type help for all commands.".green);

  while (true) {
    const input = await getInput();
    await processInput(input);
  }
}

main();