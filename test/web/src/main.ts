import './style.css';
import { PostalService } from '../../../src/mod.ts';
import type { api as MainCoordinatorApi } from './main-test-coordinator.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <h1>Web Worker Library Test (StageForge)</h1>
    <button id="runTestButton">Run Tests</button>
    <div id="testReport"><h2>Test Report</h2></div>
  </div>
`;

const testReportDiv = document.querySelector<HTMLDivElement>('#testReport')!;

async function runTestSuite() {
  testReportDiv.innerHTML = '<h2>Test Report</h2><p>Initializing and running test suite...</p>';
  const postalService = new PostalService();

  try {
    const coordinatorActorPath = new URL('./main-test-coordinator.ts', import.meta.url).href;
    testReportDiv.innerHTML += `<p>Adding Main Test Coordinator from: ${coordinatorActorPath}</p>`;
    
    const coordinatorAddress = await postalService.add(coordinatorActorPath);
    testReportDiv.innerHTML += `<p>Main Test Coordinator added with address: ${coordinatorAddress}</p>`;

    testReportDiv.innerHTML += `<p>Sending RUN_TEST_SUITE command to coordinator...</p>`;
    
    const results = await postalService.PostMessage<typeof MainCoordinatorApi>(
      {
        target: coordinatorAddress,
        type: 'RUN_TEST_SUITE',
        payload: undefined, 
      },
      true 
    );

    testReportDiv.innerHTML = '<h2>Test Report</h2>'; 

    if (Array.isArray(results)) {
      results.forEach(result => {
        const resultElement = document.createElement('div');
        resultElement.style.border = '1px solid #ccc';
        resultElement.style.padding = '5px';
        resultElement.style.marginBottom = '5px';
        resultElement.style.backgroundColor = result.status === 'success' ? '#1D351DFF' : (result.status === 'error' ? '#ffe6e6' : '#ffffcc');
        
        resultElement.innerHTML = `
          <strong>Test:</strong> ${result.description}<br>
          <strong>Status:</strong> <span style="font-weight: bold; color: ${result.status === 'success' ? 'green' : (result.status === 'error' ? 'red' : 'orange')};">${result.status.toUpperCase()}</span><br>
          ${result.details ? `<strong>Details:</strong> ${result.details}` : ''}
        `;
        testReportDiv.appendChild(resultElement);
      });
      testReportDiv.innerHTML += '<p style="font-weight: bold; color: green;">Test suite completed!</p>';
    } else {
      throw new Error("Test suite did not return a valid array of results.");
    }

  } catch (e) {
    const errorElement = document.createElement('div');
    errorElement.style.color = 'red';
    errorElement.style.border = '1px solid red';
    errorElement.style.padding = '10px';
    errorElement.innerHTML = `<strong>An unexpected error occurred during the test run:</strong><br>${(e as Error).message}<br><pre>${(e as Error).stack || ''}</pre>`;
    testReportDiv.appendChild(errorElement);
    console.error("Test run failed:", e);
  }
}

document.querySelector<HTMLButtonElement>('#runTestButton')!.addEventListener('click', runTestSuite);
