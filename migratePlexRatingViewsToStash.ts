import { promises as fs } from 'fs'
import { join } from 'path'
import { parse } from 'json2csv'
import { GraphQLClient, gql } from 'graphql-request'

const main = async () => {
    // Get the config file
    const config = JSON.parse(
        await fs.readFile(join(__dirname, 'config.json'), 'utf-8')
    )
    const jsonFilePath = join(__dirname, config.stash_json)
    const csvFilePath = join(__dirname, config.plex_csv)
    // GraphQL query to update the stash scene with the new ratings and views
    const query = gql`
        mutation SceneUpdate($id: ID!, $rating100: Int, $play_count: Int) {
            sceneUpdate(
                input: {
                    id: $id
                    rating100: $rating100
                    play_count: $play_count
                }
            ) {
                play_count
                rating100
            }
        }
    `
    const jsonFile = await fs.readFile(jsonFilePath, 'utf-8')
    const csvFile = await fs.readFile(csvFilePath, 'utf-8')
    const json = JSON.parse(jsonFile)
    const csv = csvFile.split('\n').map((line) => line.split('|'))
    // Remove double quotes from all csv values
    csv.forEach((line) =>
        line.forEach((value, index) => (line[index] = value.slice(1, -1)))
    )
    // init the graphql client
    const client = new GraphQLClient(config.graphql_url, {
        headers: {
            ApiKey: `${config.graphql_api_key}`,
        },
    })
    const results = [] as any[]

    // For each scene in the json file
    for (const scene of json.data.allScenes) {
        // Monitor time to update each scene
        const startTime = performance.now()
        // Match the scene path to the csv scene path
        const match = csv.find((line) => line[0] === scene.path)

        if (match) {
            const [path, title, views, rating] = match
            // If rating or views is 0, skip it
            if (rating === '0' || views === '0') {
                continue
            }

            // Convert rating to 0-100 in multiples of 10, or 0 if null
            const rating100 = rating ? parseInt(rating, 10) * 20 : 0
            // Convert views to int, or 0 if null
            const play_count = views ? parseInt(views, 10) : 0

            const variables = {
                id: scene.id,
                rating100,
                play_count,
            }

            try {
                const result = await client.request(query, variables)

                results.push({
                    id: scene.id,
                    path,
                    title,
                    views,
                    rating,
                    result,
                })
            } catch (error) {
                results.push({
                    id: scene.id,
                    path,
                    title,
                    views,
                    rating,
                    error,
                })
            }
            // Log the time it took to update the scene
            const endTime = performance.now()
            console.log(
                `Updated scene ${scene.id} in ${
                    Math.floor(endTime) - Math.floor(startTime)
                }ms`
            )
        }
    }

    // Write the results to a csv file
    const csvResults = parse(results, {
        fields: ['id', 'path', 'title', 'views', 'rating', 'result', 'error'],
    })

    await fs.writeFile('results.csv', csvResults)
}

main()
