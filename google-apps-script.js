// Google Apps Script to handle form submissions from the Tomato Harvest Tracker
// 1. Create a new Google Sheet
// 2. Go to Extensions > Apps Script
// 3. Paste this code
// 4. Save and Deploy as a web app (Execute as: Me, Who has access: Anyone)
// 5. Copy the web app URL and update the scriptUrl in your HTML form

// Add this to handle CORS preflight requests
function doOptions(e) {
  return ContentService.createTextOutput()
    .setMimeType(ContentService.MimeType.JSON)
    .setContent(JSON.stringify({ "status": "ok" }))
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Set up the doGet function to handle GET requests from the form
function doGet(e) {
  try {
    // Get the parameters from the request
    const parameters = e.parameter;
    
    // Access the active spreadsheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Harvest Data") || ss.insertSheet("Harvest Data");
    
    // Check if the sheet is new and set up headers if needed
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Date", "Time", "Harvester", "Tomato Variety", "Quantity"]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
      
      // Format the sheet
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, 5);
    }
    
    // Get current date and time
    const now = new Date();
    const date = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const time = Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss");
    
    // Get harvester
    const harvester = parameters.harvester;
    
    // Get the count of entries
    const count = parseInt(parameters.count) || 0;
    
    // Process each entry
    for (let i = 0; i < count; i++) {
      const variety = parameters['variety' + i];
      const quantity = parameters['quantity' + i];
      
      if (variety && quantity) {
        sheet.appendRow([
          date,
          time,
          harvester,
          variety,
          quantity
        ]);
      }
    }
    
    // Return success response
    return ContentService.createTextOutput(JSON.stringify({
      "success": true,
      "message": "Harvest data successfully recorded!"
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*');
    
  } catch (error) {
    // Log the error for debugging
    console.error("Error processing form submission: " + error);
    
    // Return error response
    return ContentService.createTextOutput(JSON.stringify({
      "success": false,
      "error": "Error processing your submission: " + error.toString()
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*');
  }
}

// Set up the doPost function to handle POST requests from the form
function doPost(e) {
  try {
    // Parse the incoming JSON data
    const data = JSON.parse(e.postData.contents);
    
    // Access the active spreadsheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Harvest Data") || ss.insertSheet("Harvest Data");
    
    // Check if the sheet is new and set up headers if needed
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Date", "Time", "Harvester", "Tomato Variety", "Quantity"]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
      
      // Format the sheet
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, 5);
    }
    
    // Get current date and time
    const now = new Date();
    const date = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const time = Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss");
    
    // Add each entry to the spreadsheet
    const harvester = data.harvester;
    const entries = data.entries;
    
    entries.forEach(entry => {
      if (entry.variety && entry.quantity) {
        sheet.appendRow([
          date,
          time,
          harvester,
          entry.variety,
          entry.quantity
        ]);
      }
    });
    
    // Return success response
    return ContentService.createTextOutput(JSON.stringify({
      "success": true,
      "message": "Harvest data successfully recorded!"
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*');
    
  } catch (error) {
    // Log the error for debugging
    console.error("Error processing form submission: " + error);
    
    // Return error response
    return ContentService.createTextOutput(JSON.stringify({
      "success": false,
      "error": "Error processing your submission: " + error.toString()
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*');
  }
}

// Add a function to create a dashboard (optional enhancement)
function createDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dashboardSheet = ss.getSheetByName("Dashboard");
  
  // Create the dashboard sheet if it doesn't exist
  if (!dashboardSheet) {
    dashboardSheet = ss.insertSheet("Dashboard");
    
    // Add title and basic info
    dashboardSheet.getRange("A1").setValue("Tomato Harvest Dashboard");
    dashboardSheet.getRange("A1:C1").merge().setFontSize(16).setFontWeight("bold");
    
    // Create sections for totals
    dashboardSheet.getRange("A3").setValue("Total Harvest by Variety");
    dashboardSheet.getRange("A3:C3").merge().setFontWeight("bold");
    
    dashboardSheet.getRange("E3").setValue("Harvest by Person");
    dashboardSheet.getRange("E3:G3").merge().setFontWeight("bold");
    
    // Set up charts and pivot tables
    const dataSheet = ss.getSheetByName("Harvest Data");
    if (dataSheet && dataSheet.getLastRow() > 1) {
      // Create pivot table for varieties
      const varietyPivot = dashboardSheet.getRange("A4");
      const varietyRange = dataSheet.getRange("D2:E" + dataSheet.getLastRow());
      
      // Create pivot table for harvesters
      const harvesterPivot = dashboardSheet.getRange("E4");
      const harvesterRange = dataSheet.getRange("C2:E" + dataSheet.getLastRow());
      
      // Note: In a real script, you would set up actual pivot tables here
      // The actual implementation would depend on how you want to analyze the data
    }
  }
  
  // Return confirmation
  return "Dashboard created/updated successfully!";
}