// This script will help you set up the Google Sheets and Google Apps Script for your Tomato Harvest Tracker

const { chromium } = require('@playwright/test');

async function setupTomatoTracker() {
  console.log('Starting the Tomato Harvest Tracker setup process...');
  
  // Launch the browser
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Step 1: Create a new Google Sheet
    console.log('Creating a new Google Sheet...');
    await page.goto('https://docs.google.com/spreadsheets/create');
    
    // Wait for the spreadsheet to load
    await page.waitForSelector('.docs-title-input');
    
    // Name the spreadsheet
    await page.click('.docs-title-input');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Tomato Harvest Tracker');
    
    // Let the user know we're waiting for them to sign in if needed
    console.log('If prompted, please sign in to your Google account.');
    console.log('Once signed in, the script will continue automatically.');
    
    // Wait a bit for the spreadsheet to save the name
    await page.waitForTimeout(3000);
    
    // Step 2: Open the Apps Script editor
    console.log('Opening the Apps Script editor...');
    
    // Click on Extensions > Apps Script
    await page.click('text=Extensions');
    await page.click('text=Apps Script');
    
    // Wait for the Apps Script tab to open
    await page.waitForTimeout(5000);
    
    // Switch to the Apps Script tab
    const pages = context.pages();
    const appsScriptPage = pages[pages.length - 1];
    
    // Wait for the Apps Script editor to load
    await appsScriptPage.waitForSelector('.navigation-item');
    
    // Rename the project
    await appsScriptPage.click('.app-script-name:has-text("Untitled project")');
    await appsScriptPage.keyboard.press('Control+a');
    await appsScriptPage.keyboard.type('Tomato Harvest Tracker');
    await appsScriptPage.keyboard.press('Enter');
    
    // Clear the default code
    await appsScriptPage.click('.CodeMirror-lines');
    await appsScriptPage.keyboard.press('Control+a');
    await appsScriptPage.keyboard.press('Delete');
    
    // Get the Google Apps Script code
    const fs = require('fs');
    const appScriptCode = fs.readFileSync('./google-apps-script.js', 'utf8');
    
    // Paste the code
    await appsScriptPage.keyboard.type(appScriptCode);
    
    // Save the project
    await appsScriptPage.keyboard.press('Control+s');
    
    console.log('Google Apps Script code has been added to the project.');
    console.log('Please follow these final steps manually:');
    console.log('1. Click on "Deploy" > "New deployment"');
    console.log('2. Select "Web app" as the deployment type');
    console.log('3. Set "Execute as" to "Me"');
    console.log('4. Set "Who has access" to "Anyone"');
    console.log('5. Click "Deploy"');
    console.log('6. Copy the web app URL that\'s provided');
    console.log('7. In your index.html file, replace "TO_BE_REPLACED_WITH_ACTUAL_SCRIPT_URL" with the copied URL');
    
    // Keep the browser open for manual steps
    console.log('The browser will remain open for you to complete these steps.');
    console.log('When finished, close the browser and the script will end.');
    
    // Wait for user to close the browser
    await browser.waitForEvent('disconnected');
    
  } catch (error) {
    console.error('An error occurred during setup:', error);
    await browser.close();
  }
}

// Run the setup
setupTomatoTracker();
