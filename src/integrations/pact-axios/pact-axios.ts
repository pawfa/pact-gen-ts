import * as tsMorph from 'ts-morph';
import * as ts from 'typescript';
import {exampleRepresentationOfType} from '../../core/create-pact-example-object';
import {InteractionCreator} from '../../core/interaction-creator';

export class PactAxios {
    public axiosCallExpression: tsMorph.CallExpression;

    constructor(currentFunctionNode: tsMorph.Node) {
        const axiosExpression = currentFunctionNode.getDescendantsOfKind(ts.SyntaxKind.CallExpression).find((callExpression) => {
            const propertyAccess = callExpression.getChildrenOfKind(ts.SyntaxKind.PropertyAccessExpression)[0];

            let currentExpression;

            /** Handle .then on axios call */
            if (propertyAccess) {
                currentExpression = propertyAccess;
            } else {
                currentExpression = callExpression;
            }

            /** Find which of the expression identifiers are coming from axios and node_modules */
            const axiosMethodIdentifier = currentExpression.getChildrenOfKind(ts.SyntaxKind.Identifier).find((identifier) => {
                const filePath = identifier.getImplementations()[0]?.getSourceFile().getFilePath();
                return filePath?.includes('axios') && filePath.includes('node_modules');
            });

            return Boolean(axiosMethodIdentifier);
        });

        if (!axiosExpression) {
            throw Error('Axios expression was not found.');
        }

        this.axiosCallExpression = axiosExpression;
    }

    getRequestMethod() {
        return this.axiosCallExpression.getDescendantsOfKind(ts.SyntaxKind.Identifier)[1]?.getText().toUpperCase();
    }

    getResponseBodyType() {
        const responseBodyType = this.axiosCallExpression.getTypeArguments()[0]?.getType();

        if (!responseBodyType) {
            throw Error(
                'Axios response body type not found. Make sure you have set Response type properly on axios request. See https://github.com/HLTech/pact-gen-ts#axios---pact-axios for more details.',
            );
        }

        return responseBodyType;
    }

    getQueryType() {
        return this.getAxiosConfigProperty('params');
    }

    getPath() {
        const firstAxiosCallArgument = this.axiosCallExpression.getArguments()[0];
        return this.getAxiosBaseURL() + this.generatePathFromNode(firstAxiosCallArgument);
    }

    getRequestBodyType() {
        const requestMethod = this.getRequestMethod();
        const secondAxiosCallArgument = this.axiosCallExpression.getArguments()[1];

        if (!secondAxiosCallArgument) {
            return;
        }

        const isRequestBodyNeeded = requestMethod && ['POST', 'PUT', 'PATCH'].includes(requestMethod);

        /** POST,PUT,PATCH in axios call have data as a second argument  */
        if (isRequestBodyNeeded) {
            return secondAxiosCallArgument.getType();
        }

        /** Other methods than POST,PUT,PATCH can pass data using axios config object and 'data' property  */
        if (secondAxiosCallArgument) {
            return this.getAxiosConfigProperty('data');
        }
    }

    private getAxiosBaseURL() {
        const axiosInstanceIdentifier = this.axiosCallExpression.getChildAtIndex(0).getChildrenOfKind(ts.SyntaxKind.Identifier)[0];
        let baseUrlPrefix = '';

        /** Check if axios was configured using Axios.create() with baseURL set */
        if (axiosInstanceIdentifier && axiosInstanceIdentifier.getImplementations().length > 0) {
            const axiosInstanceName = axiosInstanceIdentifier.getText();

            /** Handle basic case with object literal passed (example): Axios.create({baseURL: "/api"}) */
            const baseUrl = InteractionCreator.getProject()
                .getSourceFile(axiosInstanceIdentifier.getImplementations()[0]?.getSourceFile().getFilePath())
                ?.getVariableDeclaration(axiosInstanceName)
                ?.getDescendantsOfKind(ts.SyntaxKind.ObjectLiteralExpression)[0]
                ?.getProperty('baseURL');

            if (baseUrl && baseUrl.isKind(ts.SyntaxKind.PropertyAssignment)) {
                /** Take the value of baseURL property */
                const prefix = baseUrl.getInitializer()?.getText();
                if (prefix) {
                    baseUrlPrefix = prefix.replace(/["']/g, '');
                }
            }
        }

        return baseUrlPrefix;
    }

    /** Find within config object in axios call type of property */
    private getAxiosConfigProperty(property: 'data' | 'params') {
        const axiosConfig = this.axiosCallExpression
            .getArguments()
            .find((argument) => argument.getType().getProperties()[0]?.getEscapedName() === property);
        return axiosConfig?.getType().getProperty(property)?.getValueDeclaration()?.getType();
    }

    /** Recursively find path under axios url argument - which might be string, template string, concatenation, variable etc. */
    private generatePathFromNode(node: tsMorph.Node): string {
        // simple string
        if (node.getType().isStringLiteral()) {
            return node.getType().getText().replace(/["']/g, '');
        }

        // template string
        if (node.isKind(ts.SyntaxKind.TemplateExpression)) {
            return node
                .getDescendants()
                .flatMap((child) => {
                    if (child.isKind(ts.SyntaxKind.Identifier)) {
                        return exampleRepresentationOfType(child.getType().getText()) || child.getType().getText().replace(/["']/g, '');
                    } else if (
                        child.isKind(ts.SyntaxKind.TemplateMiddle) ||
                        child.isKind(ts.SyntaxKind.TemplateHead) ||
                        child.isKind(ts.SyntaxKind.TemplateTail)
                    ) {
                        return child.getText().replace(/[${}]/g, '');
                    }
                })
                .filter(Boolean)
                .join('')
                .replace(/`/g, '');
        }

        // concatenated string
        if (node.isKind(ts.SyntaxKind.BinaryExpression)) {
            return node
                .getChildren()
                .map((ch) => {
                    if (ch.getType().isStringLiteral() || ch.isKind(ts.SyntaxKind.Identifier)) {
                        return exampleRepresentationOfType(ch.getType().getText()) || ch.getType().getText().replace(/["']/g, '');
                    }
                })
                .filter(Boolean)
                .join('');
        }

        // get path from argument variable
        if (node.isKind(ts.SyntaxKind.Identifier)) {
            const variableDefinitionNodes = node.getDefinitionNodes()[0].getChildren();

            return this.generatePathFromNode(variableDefinitionNodes[variableDefinitionNodes.length - 1]);
        }

        throw Error();
    }
}
