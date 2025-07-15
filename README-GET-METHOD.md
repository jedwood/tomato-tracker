# Tomato Harvest Tracker - GET Method

This version of the Tomato Harvest Tracker uses GET requests instead of POST to avoid CORS issues. Here's how it works:

## What's Changed

1. The form now uses a hidden iframe for submitting data via GET parameters instead of using a POST request with JSON
2. The Google Apps Script has been updated to handle GET requests by parsing URL parameters
3. CORS headers have been added to both request types to allow cross-origin requests
4. The UI has been improved with proper error and success notifications

## How to Update the Google Apps Script

1. Go to your Google Sheet (https://docs.google.com/spreadsheets/d/1Fukctm2sh8TekisGromdCbFpKYeGzOVq1aIyG8NbdZE/)
2. Go to Extensions > Apps Script
3. Replace the entire Code.gs file with the contents of `google-apps-script.js`
4. Save the project
5. Re-deploy the script as a web app (Deploy > New Deployment > Web App > "Anyone" access > Deploy)
6. Copy the web app URL and verify it matches what's in the HTML file

## How the GET Method Works

Instead of using JSON in a POST request, the form data is encoded in the URL as query parameters:

```
https://script.google.com/macros/s/YOUR_ID/exec?harvester=Jed&variety0=SunGold&quantity0=5&count=1
```

This approach avoids CORS issues because:

1. GET requests are less restricted than POST requests
2. Using an iframe for navigation doesn't trigger CORS checks like fetch() does
3. We've added proper CORS headers to the Apps Script response

## Testing the Form

You can test the form by:

1. Running your local web server: `python3 -m http.server 8000`
2. Opening http://localhost:8000 in your browser
3. Filling out and submitting the form

Even though you might see the success message immediately (for better UX), the data should still be sent to the Google Sheet. You can verify this by checking the sheet after submitting.

## Further Improvements

If you continue to experience issues, you could consider:

1. Using a more robust JSONP approach
2. Setting up a proxy server to handle the requests
3. Hosting the HTML file in Google Sites or GitHub Pages
4. Using Google Forms instead of a custom form

But this approach should work for most simple use cases!
