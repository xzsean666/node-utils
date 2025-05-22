export function parseAIResponse(response: string) {
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonString = jsonMatch ? jsonMatch[1] : response;
  return JSON.parse(jsonString);
}
