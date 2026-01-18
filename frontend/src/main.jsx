import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { hardhat } from "wagmi/chains";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";

import detectEthereumProvider from '@metamask/detect-provider';

const config = getDefaultConfig({
  appName: "HUST Lottery",
  projectId: "YOUR_PROJECT_ID",
  chains: [hardhat],
  transports: {
    [hardhat.id]: http("http://127.0.0.1:8545"),
  },
  ssr: false,
});

const queryClient = new QueryClient();

async function initApp() {
  const provider = await detectEthereumProvider({ mustBeMetaMask: true, silent: true });

  if (provider) {
    console.log('✅ Ethereum provider detected:', provider);
  } else {
    console.log('⚠️ Ethereum provider not found! Please install MetaMask.');
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));

  root.render(
    <React.StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider>
            <App />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>
  );
}

initApp();