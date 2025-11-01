import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

// Google Sheets configuration
const SPREADSHEET_ID = "1vKLMGD3dm4elpvxgXtbgU3HOwWvdjsDX63xUqqjcb9Y";
const SHEET_NAME = "Sheet1"; // Default sheet name, adjust if needed

async function savePhoneToGoogleSheets(phone: string) {
  try {
    // Try to get credentials from environment variables
    // Option 1: Full service account JSON
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    // Option 2: Separate email and private key
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const serviceAccountPrivateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    let auth;

    if (serviceAccountJson) {
      // Use full JSON credential
      try {
        const credentials = JSON.parse(serviceAccountJson);
        auth = new google.auth.JWT({
          email: credentials.client_email,
          key: credentials.private_key,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        console.log("✅ Using service account JSON for authentication");
      } catch (parseError) {
        console.error("❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY JSON:", parseError);
        return false;
      }
    } else if (serviceAccountEmail && serviceAccountPrivateKey) {
      // Use separate email and key
      auth = new google.auth.JWT({
        email: serviceAccountEmail,
        key: serviceAccountPrivateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      console.log("✅ Using separate email/key for authentication");
    } else {
      console.error("❌ Google Sheets credentials not configured");
      console.error("   Missing: GOOGLE_SERVICE_ACCOUNT_KEY (JSON) or");
      console.error("   Missing: GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY");
      return false;
    }

    const sheets = google.sheets({ version: "v4", auth });

    // Append phone number to the sheet (after row 1, which is the header)
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:A`, // Column A is the Phone column
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[phone]],
      },
    });

    console.log(`✅ Phone number saved to Google Sheets: ${phone}`);
    console.log(`   Updated range: ${result.data.updates?.updatedRange || 'unknown'}`);
    return true;
  } catch (error: any) {
    console.error("❌ Error saving to Google Sheets:");
    console.error("   Error message:", error.message);
    console.error("   Error code:", error.code);
    if (error.response) {
      console.error("   Response status:", error.response.status);
      console.error("   Response data:", JSON.stringify(error.response.data));
    }
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, zip, name, phone, source } = body;

    // Validate: either email or phone must be provided
    const hasEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const hasPhone = phone && phone.trim().length > 0;

    if (!hasEmail && !hasPhone) {
      return NextResponse.json({ error: "Email or phone number is required" }, { status: 400 });
    }

    // If email is provided but invalid, return error (unless we have phone)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !hasPhone) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    // Save phone number to Google Sheets if provided
    if (hasPhone) {
      await savePhoneToGoogleSheets(phone);
    }

    // Get webhook URL from environment variable
    const webhookUrl = process.env.WEBHOOK_URL;

    if (!webhookUrl) {
      console.error("❌ WEBHOOK_URL environment variable is not set");
      // Still return success to the client, but log the error
      return NextResponse.json({ success: true, message: "Lead received (webhook not configured)" });
    }

    // Send webhook with user data
    console.log(`📤 Sending webhook to ${webhookUrl}`);
    try {
      const webhookPayload = {
        email: email || null,
        zip: zip || null,
        name: name || null,
        phone: phone || null,
        source: source || null,
        timestamp: new Date().toISOString(),
      };

      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(webhookPayload),
      });

      if (webhookResponse.ok) {
        console.log(`✅ Webhook sent successfully (status: ${webhookResponse.status})`);
      } else {
        console.error(`❌ Webhook failed with status ${webhookResponse.status}`);
        const errorText = await webhookResponse.text().catch(() => "Could not read error");
        console.error(`Error response: ${errorText}`);
      }
    } catch (webhookError) {
      console.error("❌ Error sending webhook:", webhookError);
      // Still return success to the client, but log the error
    }

    return NextResponse.json({ success: true, message: "Lead received" });
  } catch (error) {
    console.error("Error processing lead:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

