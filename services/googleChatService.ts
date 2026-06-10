
export interface GoogleChatCardParams {
  title: string;
  subtitle: string;
  details: string;
  buttons?: { text: string; url: string }[];
  prefix?: string;
}

/**
 * Sends a notification to Google Chat.
 * Uses both 'text' (for notifications/mobile) and 'cardsV2' (for rich UI with buttons).
 */
export const sendToGoogleChat = async (webhookUrl: string, params: GoogleChatCardParams) => {
  if (!webhookUrl || !webhookUrl.startsWith('http')) return false;

  const summary = `${params.prefix || '[LunchRun]'} ${params.title}: ${params.subtitle}\n${params.details}`;
  
  // Construct a robust payload
  const payload: any = {
    text: summary, // Fallback text so it's never empty
    cardsV2: [
      {
        cardId: "lunchrun_" + Date.now(),
        card: {
          header: {
            title: params.prefix || "LunchRun",
            subtitle: params.title,
            imageUrl: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/directions_run/default/48px.svg",
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: params.subtitle,
                    text: params.details,
                    wrapText: true
                  }
                }
              ]
            }
          ]
        }
      }
    ]
  };

  // Add buttons if provided
  if (params.buttons && params.buttons.length > 0) {
    payload.cardsV2[0].card.sections[0].widgets.push({
      buttonList: {
        buttons: params.buttons.map(btn => ({
          text: btn.text,
          onClick: {
            openLink: { url: btn.url }
          }
        }))
      }
    });
    
    // Add URLs to text fallback as well for compatibility
    payload.text += "\n\n" + params.buttons.map(b => `${b.text}: ${b.url}`).join("\n");
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (error) {
    console.error("Google Chat Webhook Error:", error);
    return false;
  }
};
