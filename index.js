const config = require('./config.json');
const HACClient = require('./hac-client');
const readline = require('readline');
const colors = require('colors');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ENVIRONMENT = "staged"

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

  switch (command) {
    case 'find': {
      const fileName = args[0];
      console.log(`Searching [${fileName}] through clients...`.yellow);

      for (const client of clients) {
        const files = client.searchFile(fileName);
      }

      break;
    }
    case 'download': {
      const fileName = args[0];
      console.log(`Downloading [${fileName}] from all clients...`.yellow);
      await Promise.all(clients.map(client => client.downloadFile(fileName)));
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
  await Promise.all(clients.map((client) => client.getFiles()));

  console.log("You can type help for all commands.".yellow);

  while (true) {
    const input = await getInput();
    await processInput(input);
  }
}

main();