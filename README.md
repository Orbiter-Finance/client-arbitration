# Arbitration Client

## Getting Started

To start using this arbitration client, the project can be started in one of the following ways:

1. Local startup projects

   ```shell
   yarn install
   ```
   ```shell
   npm run dev
   ```
   
2. Docker startup project

   ```shell
   docker-compose up --detach --build
   ```

## Modify Configuration

Modify your program configuration, the private key will be stored locally via encryption.

If you are on the arbitration client side, refer to the following configuration:

   ```shell
  curl --location 'http://localhost:3000/config' \
    --header 'Content-Type: application/json' \
    --data '{
        "privateKey": "Enter your private key",
        "secretKey": "Arbitrary string for encrypting the private key",
        "rpc": "Ether mainnet RPC node, e.g., https://eth.llamarpc.com",
        "debug": 1,
        "makerApiEndpoint": "https://api.orbiter.finance/maker-openapi",
        "gasLimit": "",
        "maxFeePerGas": "",
        "maxPriorityFeePerGas": "",
        "watchWalletList": ["*"]
    }'
   ```

If you are on the maker response side, refer to the following configuration:

   ```shell
  curl --location 'http://localhost:3000/config' \
    --header 'Content-Type: application/json' \
    --data '{
        "privateKey": "Enter your private key",
        "secretKey": "Arbitrary string for encrypting the private key",
        "rpc": "Ether mainnet RPC node, e.g., https://eth.llamarpc.com",
        "debug": 1,
        "makerApiEndpoint": "https://api.orbiter.finance/maker-openapi",
        "gasLimit": "",
        "maxFeePerGas": "",
        "maxPriorityFeePerGas": "",
        "makerList": ["0x8086061Cf07C03559fBB4AA58f191F9c4A5df2b2"], 
    }'
   ```

    
## Description of the program execution process

### Arbitration user-side process (arbitration/arbitrationJob.service.ts)

1.The arbitration client (this project) executes the 'challenge' contract function by obtaining the Orbiter interface unrecovered transaction information.

2.The SPV client listens to the 'challenge' function to generate the proof passed to the Orbiter interface, the arbitration client (this project) gets the proof and the information required to submit the proof through the Orbiter interface and submits the proof by executing the 'verifyChallengeSource' contract function.

3.Wait for clearing, if no maker responds to arbitration successfully, then get the reward.

### Arbitration maker-side process (arbitration/arbitrationJob.service.ts)

1.The arbitration client (this project) obtains the transactions for which proofs have been submitted through the Subgraph client and requests from the server the proofs needed for the responses to these transactions.

2.Wait for the proof to be generated and get it at the Orbiter interface, The arbitration client (this project) obtains the proof parameters required to respond to the arbitration and calls the 'verifyChallengeDest' contract function.

> Proof of generation time

- Transactions from mainnet -> zkera, at least 3h
- transactions from zkera -> mainnet, at least 24h




