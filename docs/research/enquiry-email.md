# Sending enquiry email from the Worker

Research for issue #5. Checked 2026-11-17 against Cloudflare, Resend, Brevo and Mailgun documentation. Cloudflare Email Sending is still in **public beta**, so re-check the details before building.

## Short answer

- **Yes, `send_email` works on Workers Free, but only to verified destination addresses.** Sending to any other address needs Workers Paid ($5/month). Sends to verified addresses are free and don't count toward any quota.
- That covers the **client notification**. The recipients configured in the CMS must each be verified in the Cloudflare dashboard first. A customer confirmation email (an arbitrary address) is **not possible** on the free plan with `send_email`.
- It works on the subdomain-only setup and after berghald.is is added, as long as the **From** address is on a domain in the account that has Email Routing enabled. The catch is MX records: Email Routing needs Cloudflare's MX records on the domain it is enabled for.
- If customer confirmations are wanted, use a third-party API from the Worker. **Resend** has 3,000 emails/month (100/day) free and is easy to set up, but its account data is stored in the US. **Brevo** has 300 emails/day free and stores data in the EU.

## 1. Cloudflare `send_email` binding

### Plans and recipients

| | Workers Free | Workers Paid |
|---|---|---|
| Send to **verified destination addresses** | Free, unlimited, not counted toward a quota | Same |
| Send to **arbitrary recipients** | "Not available" | 3,000/month included, then $0.35 per 1,000 |

- "Sending to arbitrary recipients requires the Workers Paid plan." Sends to verified destination addresses are free "on any plan, including when only Email Routing is configured" and "do not count toward your monthly quota or daily sending limits." ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/), [Email Routing addresses](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/))
- The 2026-04-16 changelog entry for the public beta says "Email Sending is available on the Workers paid plan." ([changelog](https://developers.cloudflare.com/email-service/platform/changelog/))
- An unrestricted binding "can send to any recipient once you onboard a sending domain. Before that, it can only send to verified destination addresses in your account." Onboarding a sending domain is the paid Email Sending feature. ([send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/))

### Verified destination addresses

- Cloudflare emails a verification link to each address. Rules that point to an address stay disabled until it is verified. ([Email Routing addresses](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/))
- Addresses are **account-level**: "shared at the account level and can be reused with any other domain in your account." ([same](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/))
- Limit: **200 destination addresses per account**, shared by every domain on the account. ([limits](https://developers.cloudflare.com/email-routing/limits/)) This budget is shared by every Norduo client site on the same account. It is enough for now, but it is a shared limit.
- Sending to an unverified address fails with `E_RECIPIENT_PLAN_RESTRICTED` or `E_RECIPIENT_NOT_ALLOWED`. ([Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/))

**What this means for the CMS:** the client can edit the comma-separated recipient list in Vefstjórn, but a new address only works after someone verifies it in the Cloudflare dashboard. That step is outside the CMS. The admin should show a clear warning, and the Worker should handle `E_RECIPIENT_*` errors per address. The enquiry is already saved in D1, so a failed email loses no data.

### Binding restrictions (Wrangler)

`destination_address` limits the binding to one address. `allowed_destination_addresses` limits it to a list. `allowed_sender_addresses` limits the From addresses. ([send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/))

```toml
[[send_email]]
name = "EMAIL"
allowed_sender_addresses = ["noreply@<sending-domain>"]
```

If the recipient list lives in the CMS, don't put it in `allowed_destination_addresses`, or every change would need a redeploy. The account's verified-address list already limits where mail can go.

### Message shape and limits

- `to`, `cc` and `bcc` each accept a string, an `EmailAddress`, or an array. Together they can hold **at most 50 recipients**. ([Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [limits](https://developers.cloudflare.com/email-service/platform/limits/))
- `replyTo` is supported. Set it to the customer's address so the client can reply straight from their inbox.
- Attachments: up to 32 per message. `content` can be a base64 string, an `ArrayBuffer` or an `ArrayBufferView`.
- **Total message size: 25 MiB, attachments included.** ([limits](https://developers.cloudflare.com/email-service/platform/limits/))
- Headers: 16 KB in total, each value up to 2,048 bytes.
- Local dev: binary (`ArrayBuffer`) attachments "cannot be serialized by the local simulator". Use base64 in dev or remote bindings. ([Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/))
- Daily quota: "New accounts start with a conservative daily quota and scale up over time." Verified-destination sends are exempt.
- Sends from a Worker show as "dropped" in the Email Routing summary. That is expected; check Email Sending logs instead. ([limits](https://developers.cloudflare.com/email-routing/limits/))

**Photos:** passing R2 object bytes as `ArrayBuffer` avoids base64 work in the Worker, which matters with the 10 ms CPU limit. The form must keep total photo size well under 25 MiB, or attach only the first few photos and link to the rest in Vefstjórn. A link only helps the client if it sits behind Cloudflare Access, because the photos may contain personal data.

### From domain

- The From address must be on a domain in the account that Cloudflare accepts as a sender. Without Email Sending onboarding, that means a domain with Email Routing enabled. The documented errors are `E_SENDER_DOMAIN_NOT_AVAILABLE` ("not onboarded to Email Service, owned by another account, or not active for sending") and `E_SENDER_NOT_VERIFIED`. ([Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)) The docs don't spell out the routing-only From rule in one sentence. *Verify with a test send before building.*
- "You must be using Cloudflare DNS to use Email Service." ([get started](https://developers.cloudflare.com/email-service/get-started/send-emails/))
- **MX conflict:** "Email Routing requires Cloudflare MX records." Enabling it fails with error 2008 if other MX records exist, and it "cannot [be used] with external mail servers." ([domains](https://developers.cloudflare.com/email-service/configuration/domains/))
- Subdomains: you add them from the apex domain's Email Routing settings, and Cloudflare adds DNS records to the subdomain. Catch-all rules work only on the apex. ([subdomains](https://developers.cloudflare.com/email-routing/setup/subdomains/))

### Does it work before and after launch?

| Stage | Works? | Notes |
|---|---|---|
| Pre-launch, site on `berghald.eythorkonrads.com` | Yes, if Email Routing can be enabled on `eythorkonrads.com` | From is something like `noreply@eythorkonrads.com`. If that zone already gets mail from another provider, Email Routing can't be enabled there (MX conflict). In that case, try routing on a subdomain, and check whether that needs the apex enabled first. |
| After berghald.is is added to the account | Yes, and nothing changes in the code except the From address | Destination addresses are account-level, so they keep working. The client's own mailbox on `berghald.is` will have non-Cloudflare MX records, so **don't enable Email Routing on the apex**. Keep sending from the pre-launch domain, or enable routing on a subdomain such as `mail.berghald.is` if the docs allow that without the apex. |

The DNS layout of the real domains is not public and was not checked here. Check it in the dashboard before choosing the From domain.

### Customer confirmation with Cloudflare

Not possible on Workers Free: the customer's address is arbitrary. It would need Workers Paid plus Email Sending onboarding. Onboarding adds MX, SPF, DKIM and DMARC records under `cf-bounce.<domain>`, so it doesn't conflict with the client's mailbox. ([get started](https://developers.cloudflare.com/email-service/get-started/send-emails/)) That breaks the "free tier only" rule.

## 2. Fallback providers (called with `fetch` from the Worker)

### Resend

- **Free tier:** 3,000 emails/month, **100/day**, 3 domains, 30-day data retention. ([pricing](https://resend.com/pricing))
- **API:** `to` takes up to 50 addresses. Attachments are a base64 string or a `path` (a URL that Resend fetches), **max 40 MB per email after base64 encoding**. `reply_to` is supported. ([send email](https://resend.com/docs/api-reference/emails/send-email)) With `path`, the Worker doesn't have to base64-encode photos, which helps with the CPU limit, but the URL must be reachable by Resend (for example, a short-lived signed R2 URL).
- **EU data:** you can send from `eu-west-1` (Ireland), but "it does not control where customer data is stored". Account data, metadata and logs are "stored in the United States". ([regions](https://resend.com/docs/dashboard/domains/regions)) The DPA covers transfers with the EU SCCs and the EU-U.S. Data Privacy Framework, and it is part of the Terms of Service. ([DPA](https://resend.com/legal/dpa))
- **Domain setup:** Resend recommends sending from a subdomain. On Cloudflare, Domain Connect can add the records automatically. Manually, you add an `MX send`, a `TXT send` (`v=spf1 include:amazonses.com ~all`) and a `TXT resend._domainkey` (DKIM, DNS only). ([Cloudflare guide](https://resend.com/docs/dashboard/domains/cloudflare), [domains](https://resend.com/docs/dashboard/domains/introduction)) The records sit on `send.` and `resend._domainkey`, so **they don't touch the client's MX**.
- **Customer confirmation:** yes, to any address, within 100 per day.

### Brevo (Paris, France)

- **Free tier:** 300 emails/day, no time limit, no credit card, includes API access. ([transactional email](https://www.brevo.com/products/transactional-email/), [email API](https://www.brevo.com/features/email-api/))
- **EU data:** "The hosting servers on which Brevo processes and stores its databases are all located within the European Union" (OVH in France and Germany, Google Cloud in Belgium). Some group companies and sub-processors outside the EU have access. ([data storage location](https://help.brevo.com/hc/en-us/articles/360001005510-Data-storage-location), [terms](https://www.brevo.com/legal/termsofuse/))
- **Domain setup:** you authenticate the domain with Brevo's DKIM and a Brevo code TXT record, plus DMARC. Nothing changes the MX records. *Exact records are shown in the Brevo dashboard and were not checked here.*
- **Not checked:** whether free-plan emails carry Brevo branding, and the attachment size limit. Check both before choosing Brevo.
- **Customer confirmation:** yes.

### Mailgun (brief)

- Free: 100 emails/day, one custom domain, about 1 day of log retention. ([pricing](https://www.mailgun.com/pricing/)) There is an EU region, but its own pages conflict on whether the free plan can use it. No advantage over Resend or Brevo here.

## Comparison

| | CF `send_email` (Free) | Resend Free | Brevo Free |
|---|---|---|---|
| Client notification | Yes, verified addresses only | Yes | Yes |
| Customer confirmation | **No** | Yes | Yes |
| Volume | Unlimited to verified addresses | 100/day, 3,000/month | 300/day |
| Attachments | 25 MiB total, binary OK | 40 MB (base64) or URL `path` | not checked |
| Data location | Cloudflare (already our processor) | US (SCCs + DPF) | EU |
| New secret / vendor | None | API key, new processor | API key, new processor |
| DNS impact | Email Routing MX on its domain | `send.` + DKIM only | DKIM/TXT only |

## Recommendation

1. **v1: use the `send_email` binding for the client notification.** It is free, needs no API key, and adds no new data processor. Set `replyTo` to the customer's address. Attach photos as `ArrayBuffer` from R2, capped well under 25 MiB. Send from a `noreply@` on a domain where Email Routing can be enabled without breaking existing mail (decide that after checking the zone's MX records). Verify each recipient in Cloudflare, and say so in the Vefstjórn recipient field's help text.
2. **No customer confirmation email in v1.** Show a clear confirmation on the page instead. This matches architecture.md §4.
3. **If confirmations are wanted later:** add one provider behind a small `sendEmail` interface in the site, not in `packages/cms`. Prefer **Brevo** if EU data storage matters to the client, or **Resend** for the simplest setup and Cloudflare auto-DNS. Either stays within the free tier at Berghald's volume. Don't move to Workers Paid for this alone, because it breaks the free-tier rule.
4. Before building, do a quick test send on the account to confirm the routing-only From rule and whether subdomain routing needs the apex enabled.
