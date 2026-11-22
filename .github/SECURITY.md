# Security Policy

Postline holds the credentials that let it post as you, so reports of security
problems are taken seriously and handled privately.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: on the repository's **Security** tab,
choose **Report a vulnerability**. If that option is not available to you,
email <chris@stacksjs.org> with "Postline security" in the subject.

Include what you can of:

- the version or commit you tested, and whether it was the Mac app or a
  self-hosted install
- the steps to reproduce it
- what an attacker gains

You will get an acknowledgement within three working days. Once a fix is
released, the advisory is published and you are credited unless you ask not to
be.

## Supported versions

Postline is pre-1.0. Fixes land on `main` and ship in the next release; older
releases are not patched.

## Scope

In scope: this repository, the Mac app built from it, and a self-hosted
install running with the shipped defaults.

Out of scope: the social networks themselves, and problems that need an
attacker to already have the owner's session, machine or database file.
