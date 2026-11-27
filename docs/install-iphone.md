# Build Postline for iPhone

The iPhone app opens Postline's responsive workspace in a Craft window. Your
workspace server stores drafts and connections, runs the scheduler, and sends
posts while the app is closed.

## Run it in Xcode

Follow the [source setup steps](../README.md#getting-started) on a Mac with
Xcode and an iOS simulator runtime. From the project directory, use Buddy to
install the iOS build tools and generate the Xcode project.

```bash
./buddy setup:ios
./buddy build:ios
open storage/framework/mobile/ios/Postline.xcodeproj
```

Select the Postline scheme and an iPhone simulator, then choose **Product >
Run**. The app opens the Composer at the configured workspace and asks you to
sign in if needed.

## Use your own workspace

Deploy Postline using the [self-hosting guide](self-hosting.md). Set
`APP_DOMAIN` to your workspace hostname when generating the iPhone project.
The phone needs to reach that host over HTTPS.

```bash
APP_DOMAIN=postline.example.org ./buddy build:ios
```

Rebuild the app in Xcode after changing the hostname.
