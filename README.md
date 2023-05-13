# plex-to-stash-ratings

## Transfer scene rating and view count from Plex to Stash.
![Progress](assets/progress.gif)

### NOTE: Intended for fresh installs before previous view/rating counts exist.

Matches file paths between Plex and Stash DBs to find the Stash IDs. Assumes file paths are the same (like with docker mounts). If your parent folders differ, you can easily find&replace it in your files.

# 1. Plex export using [WebTools-NG](https://github.com/WebTools-NG/WebTools-NG/releases)
- Download WebTools and sign in to select your server.
- Set your settings as shown below
![Export Settings](assets/export_settings.png)
![Custom Levels](assets/custom_levels.png)

# 2. Setup `config.json`:

```
{
    "plex_csv": "ratings_views.csv",
    "graphql_url": "",
    "graphql_api_key": ""
}
```

# 3. Install dependencies
`pnpm install`


# 4. Run
`pnpm ts-node migratePlexRatingViewsToStash.ts`