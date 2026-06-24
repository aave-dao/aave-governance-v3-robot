// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {Script} from 'forge-std/Script.sol';
import {console} from 'forge-std/console.sol';
import {MailboxCRE} from '../src/contracts/MailboxCRE.sol';

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployEthereum chain=mainnet
contract DeployEthereum is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE ethereum address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployPolygon chain=polygon
contract DeployPolygon is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE polygon address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployAvalanche chain=avalanche
contract DeployAvalanche is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE avalanche address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployGnosis chain=gnosis
contract DeployGnosis is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE gnosis address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployInk chain=ink
contract DeployInk is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE ink address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployPlasma chain=plasma
contract DeployPlasma is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE plasma address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployLinea chain=linea
contract DeployLinea is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE linea address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeploySonic chain=sonic
contract DeploySonic is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE sonic address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployCelo chain=celo
contract DeployCelo is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE celo address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployScroll chain=scroll
contract DeployScroll is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE scroll address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployXLayer chain=xlayer
contract DeployXLayer is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE xlayer address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployMantle chain=mantle
contract DeployMantle is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE mantle address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployMegaETH chain=megaeth
contract DeployMegaETH is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE megaeth address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger-zk contract=scripts/MailboxCRE.s.sol:DeployZkSync chain=zksync
contract DeployZkSync is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE zksync address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployArbitrum chain=arbitrum
contract DeployArbitrum is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE arbitrum address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployOptimism chain=optimism
contract DeployOptimism is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE optimism address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployBnb chain=bnb
contract DeployBnb is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE bnb address', address(mailbox));
    vm.stopBroadcast();
  }
}

// make deploy-ledger contract=scripts/MailboxCRE.s.sol:DeployBase chain=base
contract DeployBase is Script {
  function run() external {
    vm.startBroadcast();
    MailboxCRE mailbox = new MailboxCRE();
    console.log('MailboxCRE base address', address(mailbox));
    vm.stopBroadcast();
  }
}
