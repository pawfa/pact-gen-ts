import Axios from 'axios';

export const axiosInstance = Axios.create();

export const axiosInstanceWithBaseURL = Axios.create({
    baseURL: '/api/v1',
});
