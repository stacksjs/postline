# LinkedIn

**You need:** a LinkedIn developer app, which LinkedIn requires to be linked
to a LinkedIn Page you manage. Free.

1. Open [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps)
   and create an app, linked to a Page you manage (any Page; it only vouches
   for the app).
2. Under **Products**, add **Sign In with LinkedIn using OpenID Connect** and
   **Share on LinkedIn**. Both are granted at once.
3. Under **Auth**, add the redirect address from Postline's Settings,
   Channels as an **Authorized redirect URL**.
4. Copy the **Client ID** and **Primary Client Secret** into Postline under
   **Settings > Channels > Your network apps > LinkedIn**, save, then choose
   **Connect with LinkedIn**.

Postline asks for `openid`, `profile` and `w_member_social`: who you are, and
permission to post as you.

## Posting as a company Page

Add the **Community Management API** product to the same app (LinkedIn reviews
this one), then tick **Also connect the company Pages I administer** before
connecting. Postline then also asks for `w_organization_social` and
`r_organization_admin`, and adds an account for each Page you can post for.
Without that product LinkedIn refuses the whole sign-in, which is why it is
off unless you turn it on.

- **Limits:** 3,000 characters, up to four images. Hashtags stay hashtags.
- **Sign-ins expire** after 60 days unless LinkedIn has enrolled your app in
  refresh tokens; Postline says when an account needs connecting again.
- Cleanup can delete posts Postline published; listing older history needs a
  partner permission LinkedIn grants rarely.
