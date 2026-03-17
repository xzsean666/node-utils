import { gh } from '.';
const setValue = `
mutation Mutation($key: String!, $value: JSON!) {
  setValue(key: $key, value: $value)
}
`;
const getValue = `
query Query($getValueKey2: String!) {
  getValue(key: $getValueKey2)
}
`;

async function main() {
  try {
    const mutation = await gh.mutate(setValue, {
      key: '234',
      value: {
        testG: 'test',
        test2: 'test2',
        test3: 'test3',
      },
    });
    const query = await gh.query(getValue, {
      getValueKey2: '234',
    });

    console.log('Mutation result:', mutation);
    console.log('Query result:', query);
  } catch (error) {
    console.error('Error executing mutation:', error);
  }
}

main().catch(console.error);
